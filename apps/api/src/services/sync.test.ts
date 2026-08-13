import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SyncEngine, mergeExternalChange } from "./sync.js";

const now = () => new Date("2026-07-21T12:00:00.000Z");

describe("external sync merge", () => {
  it("applies a one-sided shared remote update and preserves a local-only change", () => {
    const link = {
      baseline: { title: "Old", owner: "Alex" },
      field_mappings: [
        { local_field: "title", external_field: "title", ownership: "shared" as const },
        { local_field: "owner", external_field: "assignee", ownership: "shared" as const },
      ],
    };
    const merged = mergeExternalChange(
      link,
      { title: "Old", owner: "Sam" },
      {
        provider: "github",
        external_id: "acme/repo#1",
        kind: "issue",
        title: "New",
        assignee: "Alex",
        labels: [],
        properties: {},
      },
    );
    expect(merged.patch).toEqual({ title: "New" });
    expect(merged.conflicts).toEqual([]);
  });

  it("raises a field conflict for incompatible shared updates", () => {
    const merged = mergeExternalChange(
      {
        baseline: { title: "Old" },
        field_mappings: [
          { local_field: "title", external_field: "title", ownership: "shared" as const },
        ],
      },
      { title: "Local rewrite" },
      {
        provider: "linear",
        external_id: "lin-1",
        kind: "issue",
        title: "Remote rewrite",
        labels: [],
        properties: {},
      },
    );
    expect(merged.patch).toEqual({});
    expect(merged.conflicts).toMatchObject([{ field: "title" }]);
  });
});

describe("SyncEngine", () => {
  it("deduplicates verified webhooks and applies external-owned fields through its gateway", async () => {
    const applied: Record<string, unknown>[] = [];
    const engine = new SyncEngine({
      now,
      resolveSecret: async () => "secret",
      gateway: {
        readLocal: async () => ({ title: "Old", state: "open" }),
        applyInbound: async (_link, patch) => {
          applied.push(patch);
        },
      },
    });
    const connection = engine.createConnection({
      id: "conn_1",
      provider: "github",
      display_name: "GitHub",
    });
    engine.createLink({
      id: "sync_1",
      connection_id: connection.id,
      board_id: "brd_1",
      resource_id: "blk_1",
      external_id: "acme/repo#1",
      direction: "bidirectional",
      field_mappings: [
        { local_field: "state", external_field: "state", ownership: "external" },
      ],
      baseline: { state: "open" },
    });
    const rawBody = new TextEncoder().encode(
      JSON.stringify({
        action: "closed",
        repository: { full_name: "acme/repo" },
        issue: { id: 1, number: 1, title: "Issue", state: "closed", labels: [] },
      }),
    );
    const signature = createHmac("sha256", "secret").update(rawBody).digest("hex");
    const headers = {
      "x-hub-signature-256": `sha256=${signature}`,
      "x-github-event": "issues",
      "x-github-delivery": "delivery-1",
    };

    const first = await engine.ingestWebhook(connection.id, headers, rawBody);
    const second = await engine.ingestWebhook(connection.id, headers, rawBody);
    expect(first).toMatchObject({ accepted: true, applied: 1, duplicate: false });
    expect(second).toMatchObject({ accepted: true, duplicate: true, applied: 0 });
    expect(applied).toEqual([{ state: "closed" }]);
  });

  it("fences stale outbound effects after a restore generation changes", async () => {
    let generation = 2;
    const engine = new SyncEngine({
      now,
      gateway: {
        readLocal: async () => ({}),
        applyInbound: async () => {},
        getEffectGeneration: async () => generation,
      },
    });
    const connection = engine.createConnection({
      id: "conn_2",
      provider: "linear",
      display_name: "Linear",
    });
    const link = engine.createLink({
      id: "sync_2",
      connection_id: connection.id,
      board_id: "brd_2",
      resource_id: "blk_2",
      external_id: "lin-2",
      direction: "outbound",
      field_mappings: [
        { local_field: "title", external_field: "title", ownership: "visboard" },
      ],
      baseline: { title: "Old" },
    });
    const stale = await engine.deliverOutbound(
      link.id,
      { title: "New" },
      async () => ({ remoteVersion: "v2" }),
      1,
    );
    expect(stale).toMatchObject({ delivered: false, reason: "Board effect generation has changed" });

    generation = 2;
    const delivered = await engine.deliverOutbound(
      link.id,
      { title: "New" },
      async () => ({ remoteVersion: "v2" }),
      2,
    );
    expect(delivered).toEqual({ delivered: true, duplicate: false });
  });
});
