import { afterEach, describe, expect, it, vi } from "vitest";
import { VisBoardClient } from "./client.js";
import { VisBoardError } from "./error.js";

const BASE_URL = "http://localhost:8080/v1";

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("VisBoardClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists workspaces with auth header", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toBe(`${BASE_URL}/workspaces`);
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer vb_pat_test",
      });
      return jsonResponse({ data: [{ id: "ws_1", slug: "acme", name: "Acme" }] });
    });

    const client = new VisBoardClient({
      baseUrl: BASE_URL,
      token: "vb_pat_test",
      fetch,
    });

    const workspaces = await client.workspaces.list();
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.slug).toBe("acme");
  });

  it("creates a project", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toBe(`${BASE_URL}/workspaces/acme/projects`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(init?.body as string)).toEqual({
        name: "Pipeline",
        slug: "pipeline",
      });
      return jsonResponse({
        id: "prj_1",
        slug: "pipeline",
        name: "Pipeline",
        status: "active",
      });
    });

    const client = new VisBoardClient({ baseUrl: BASE_URL, token: "t", fetch });
    const project = await client.projects.create("acme", {
      name: "Pipeline",
      slug: "pipeline",
    });
    expect(project.slug).toBe("pipeline");
  });

  it("sends If-Match on note update", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toBe(`${BASE_URL}/workspaces/acme/projects/demo/notes/nt_1`);
      expect(init?.headers).toMatchObject({ "If-Match": 'W/"2"' });
      return jsonResponse({ id: "nt_1", version: 3 });
    });

    const client = new VisBoardClient({ baseUrl: BASE_URL, token: "t", fetch });
    const note = await client.notes.update(
      "acme",
      "demo",
      "nt_1",
      { title: "Updated" },
      'W/"2"',
    );
    expect(note.version).toBe(3);
  });

  it("appends events", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toBe(`${BASE_URL}/workspaces/acme/projects/demo/events`);
      expect(JSON.parse(init?.body as string)).toEqual({
        type: "agent.turn.completed",
        payload: { summary: "done" },
      });
      return jsonResponse({ id: "evt_1", type: "agent.turn.completed" });
    });

    const client = new VisBoardClient({ baseUrl: BASE_URL, token: "t", fetch });
    const event = await client.events.append("acme", "demo", {
      type: "agent.turn.completed",
      payload: { summary: "done" },
    });
    expect(event.id).toBe("evt_1");
  });

  it("fetches context with include query", async () => {
    const fetch = mockFetch((url) => {
      expect(url).toBe(
        `${BASE_URL}/workspaces/acme/projects/demo/context?include=headings`,
      );
      return jsonResponse({
        project: { id: "prj_1", slug: "demo", name: "Demo" },
        agents_md: "# AGENTS.md",
        notes: [],
        checklists: [],
        files: [],
        participants: { users: [], agents: [] },
      });
    });

    const client = new VisBoardClient({ baseUrl: BASE_URL, token: "t", fetch });
    const ctx = await client.context.get("acme", "demo", { include: "headings" });
    expect(ctx.project.slug).toBe("demo");
  });

  it("throws VisBoardError for problem+json responses", async () => {
    const fetch = mockFetch(() =>
      new Response(
        JSON.stringify({
          type: "https://visboard.dev/errors/not-found",
          title: "Not Found",
          status: 404,
          detail: "Project missing",
        }),
        {
          status: 404,
          headers: { "content-type": "application/problem+json" },
        },
      ),
    );

    const client = new VisBoardClient({ baseUrl: BASE_URL, token: "t", fetch });

    await expect(client.projects.get("acme", "missing")).rejects.toBeInstanceOf(
      VisBoardError,
    );
    await expect(client.projects.get("acme", "missing")).rejects.toMatchObject({
      status: 404,
      title: "Not Found",
      detail: "Project missing",
    });
  });

  it("bootstraps without auth token", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toBe(`${BASE_URL}/bootstrap`);
      expect(init?.headers).not.toHaveProperty("Authorization");
      return jsonResponse({
        workspace: { id: "ws_1", slug: "smoke", name: "Smoke" },
        user: { id: "user_1", display_name: "Admin" },
        token: "vb_pat_new",
      });
    });

    const client = new VisBoardClient({ baseUrl: BASE_URL, fetch });
    const result = await client.bootstrap.create({ name: "Smoke", slug: "smoke" });
    expect(result.token).toBe("vb_pat_new");
  });

  it("bootstraps with X-Bootstrap-Token header", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toBe(`${BASE_URL}/bootstrap`);
      expect(init?.headers).toMatchObject({
        "X-Bootstrap-Token": "secret-bootstrap",
      });
      return jsonResponse({
        workspace: { id: "ws_1", slug: "smoke", name: "Smoke" },
        user: { id: "user_1", display_name: "Admin" },
        token: "vb_pat_new",
      });
    });

    const client = new VisBoardClient({ baseUrl: BASE_URL, fetch });
    const result = await client.bootstrap.create({
      name: "Smoke",
      slug: "smoke",
      bootstrapToken: "secret-bootstrap",
    });
    expect(result.token).toBe("vb_pat_new");
  });
});

describe("VisBoardError", () => {
  it("parses problem+json from response", async () => {
    const response = new Response(
      JSON.stringify({
        title: "Forbidden",
        status: 403,
        detail: "Insufficient scope",
      }),
      {
        status: 403,
        headers: { "content-type": "application/problem+json" },
      },
    );

    const error = await VisBoardError.fromResponse(response);
    expect(error.status).toBe(403);
    expect(error.title).toBe("Forbidden");
    expect(error.detail).toBe("Insufficient scope");
  });
});

describe("V2 board resources", () => {
  it("uses canonical board routes and forwards command preconditions", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toBe(
        "http://localhost:8080/v2/workspaces/ws_01/boards/brd_01/commands",
      );
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer t",
        "Idempotency-Key": "cmd-retry-key",
        "If-Board-Revision": "rev_01",
        "If-Board-Document": "bdoc_01",
      });
      expect(JSON.parse(init?.body as string)).toMatchObject({
        command_id: "cmd_01",
        kind: "block.create",
      });
      return jsonResponse({ status: "applied" });
    });

    const client = new VisBoardClient({
      baseUrl: "http://localhost:8080/v2",
      token: "t",
      fetch,
    });
    const receipt = await client.boards.command(
      "ws_01",
      "brd_01",
      { command_id: "cmd_01", kind: "block.create" },
      {
        idempotencyKey: "cmd-retry-key",
        expectedRevisionId: "rev_01",
        expectedDocumentId: "bdoc_01",
      },
    );

    expect(receipt.status).toBe("applied");
  });

  it("installs a published template version on a board", async () => {
    const fetch = mockFetch((url, init) => {
      expect(url).toBe(
        "http://localhost:8080/v2/workspaces/ws_01/boards/brd_01/template-installations",
      );
      expect(JSON.parse(init?.body as string)).toEqual({
        template_version_id: "tplv_01",
        variables: { repository: "visboard" },
      });
      return jsonResponse({
        installation: { id: "tpli_01" },
        blocks: [],
        revision: { id: "rev_01" },
      });
    });

    const client = new VisBoardClient({
      baseUrl: "http://localhost:8080/v2",
      token: "t",
      fetch,
    });
    const result = await client.boards.installTemplate("ws_01", "brd_01", {
      template_version_id: "tplv_01",
      variables: { repository: "visboard" },
    });

    expect(result.revision.id).toBe("rev_01");
  });
});
