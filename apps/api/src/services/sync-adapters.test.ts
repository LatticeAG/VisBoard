import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSyncAdapter } from "./sync-adapters.js";

function signedInput(
  payload: unknown,
  secret: string,
  headers: Record<string, string>,
) {
  const rawBody = new TextEncoder().encode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  return {
    rawBody,
    secret,
    headers: { ...headers, signature },
    signature,
    receivedAt: new Date("2026-07-21T12:00:00.000Z"),
  };
}

describe("external sync adapters", () => {
  it("verifies and normalizes GitHub issue deliveries", () => {
    const secret = "github-secret";
    const input = signedInput(
      {
        action: "edited",
        repository: { full_name: "acme/visboard" },
        issue: {
          id: 42,
          number: 7,
          title: "Ship V3",
          body: "Connector work",
          state: "open",
          html_url: "https://github.com/acme/visboard/issues/7",
          labels: [{ name: "v3" }],
          assignee: { login: "octo" },
          updated_at: "2026-07-21T11:00:00Z",
        },
      },
      secret,
      {
        "x-github-event": "issues",
        "x-github-delivery": "delivery-1",
      },
    );
    const adapter = getSyncAdapter("github");
    expect(
      adapter.verifyWebhook({
        ...input,
        headers: {
          ...input.headers,
          "x-hub-signature-256": `sha256=${input.signature}`,
        },
      }).valid,
    ).toBe(true);

    const [change] = adapter.normalizeWebhook({
      ...input,
      headers: {
        ...input.headers,
        "x-hub-signature-256": `sha256=${input.signature}`,
      },
    });
    expect(change?.object.external_id).toBe("acme/visboard#7");
    expect(change?.object.kind).toBe("issue");
    expect(change?.object.labels).toEqual(["v3"]);
    expect(change?.delivery_id).toBe("delivery-1");
  });

  it("normalizes Notion page properties and Linear issue data", () => {
    const notion = getSyncAdapter("notion");
    const notionBody = new TextEncoder().encode(
      JSON.stringify({
        type: "page.content_updated",
        data: {
          id: "page-1",
          object: "page",
          url: "https://www.notion.so/page-1",
          last_edited_time: "2026-07-21T11:00:00Z",
          properties: {
            Name: { title: [{ plain_text: "Incident" }] },
            Notes: { rich_text: [{ plain_text: "Mitigated" }] },
          },
        },
      }),
    );
    const notionSignature = createHmac("sha256", "notion-secret")
      .update(notionBody)
      .digest("hex");
    const [notionChange] = notion.normalizeWebhook({
      rawBody: notionBody,
      secret: "notion-secret",
      headers: { "x-notion-signature": notionSignature, "x-notion-delivery-id": "n-1" },
    });
    expect(notionChange?.object.title).toBe("Incident");
    expect(notionChange?.object.body).toBe("Mitigated");

    const linear = getSyncAdapter("linear");
    const linearBody = new TextEncoder().encode(
      JSON.stringify({
        type: "Issue",
        action: "update",
        data: {
          id: "lin-1",
          identifier: "ENG-42",
          title: "Automate sync",
          description: "Use durable events",
          state: { name: "In Progress" },
          labels: [{ name: "platform" }],
          url: "https://linear.app/acme/issue/ENG-42",
        },
      }),
    );
    const linearSignature = createHmac("sha256", "linear-secret")
      .update(linearBody)
      .digest("hex");
    const [linearChange] = linear.normalizeWebhook({
      rawBody: linearBody,
      secret: "linear-secret",
      headers: { "x-linear-signature": linearSignature },
    });
    expect(linearChange?.object.external_id).toBe("lin-1");
    expect(linearChange?.object.state).toBe("In Progress");
    expect(linearChange?.object.labels).toEqual(["platform"]);
  });

  it("rejects a malformed provider signature", () => {
    const adapter = getSyncAdapter("github");
    const result = adapter.verifyWebhook({
      rawBody: new TextEncoder().encode("{}"),
      secret: "secret",
      headers: { "x-hub-signature-256": "sha256=not-a-real-signature" },
    });
    expect(result.valid).toBe(false);
  });
});
