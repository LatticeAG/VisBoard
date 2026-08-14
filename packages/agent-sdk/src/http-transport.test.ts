import type { RequestOptions } from "@visboard/sdk";
import { describe, expect, it } from "vitest";
import { type AgentHttpClient, HttpAgentTransport } from "./index.js";

class RecordingClient implements AgentHttpClient {
  readonly baseUrl = "https://visboard.example/v1";
  readonly calls: Array<{ path: string; options: RequestOptions | undefined }> = [];

  request<T>(path: string, options?: RequestOptions): Promise<T> {
    this.calls.push({ path, options });
    return Promise.resolve({} as T);
  }
}

const access = { run_id: "arun_01", lease_id: "lease_01" };

describe("HttpAgentTransport", () => {
  it("maps workspace file mutations to canonical V2 paths and carries the lease in the body", async () => {
    const client = new RecordingClient();
    const transport = new HttpAgentTransport({ client, workspace_id: "ws_01" });

    await transport.writeFile({
      board_id: "brd_01",
      agent_workspace_id: "aws_01",
      path: "src/index.ts",
      content: "export {};\n",
      expected_etag: 'W/"1-test"',
      access,
    });

    expect(client.calls).toEqual([
      {
        path: "https://visboard.example/v2/workspaces/ws_01/boards/brd_01/agent-workspaces/aws_01/files/src/index.ts",
        options: {
          method: "PUT",
          body: {
            content: "export {};\n",
            expected_etag: 'W/"1-test"',
            generated: undefined,
            access,
          },
        },
      },
    ]);
  });

  it("uses V2 handoff endpoints and exposes list filtering", async () => {
    const client = new RecordingClient();
    const transport = new HttpAgentTransport({ client, workspace_id: "ws_01" });

    await transport.listHandoffs({ board_id: "brd_01", state: "awaiting_review" });
    await transport.submitHandoff({ board_id: "brd_01", handoff_id: "hof_01", access });
    await transport.resumeHandoff({
      board_id: "brd_01",
      handoff_id: "hof_01",
      agent_id: "agent_01",
      mode: "operate",
    });

    expect(client.calls).toEqual([
      {
        path: "https://visboard.example/v2/workspaces/ws_01/boards/brd_01/handoffs",
        options: { query: { state: "awaiting_review" } },
      },
      {
        path: "https://visboard.example/v2/workspaces/ws_01/boards/brd_01/handoffs/hof_01/submit",
        options: { method: "POST", body: { access } },
      },
      {
        path: "https://visboard.example/v2/workspaces/ws_01/boards/brd_01/handoffs/hof_01/resume",
        options: {
          method: "POST",
          body: {
            agent_id: "agent_01",
            mode: "operate",
            goal: undefined,
            requested_capabilities: undefined,
            allowed_paths: undefined,
            lease_duration_ms: undefined,
          },
        },
      },
    ]);
  });

  it("sends run and lease identifiers as read queries where a GET body is unavailable", async () => {
    const client = new RecordingClient();
    const transport = new HttpAgentTransport({ client, workspace_id: "ws_01" });

    await transport.readFile({
      board_id: "brd_01",
      agent_workspace_id: "aws_01",
      path: "docs/with space.md",
      access,
    });

    expect(client.calls[0]).toEqual({
      path: "https://visboard.example/v2/workspaces/ws_01/boards/brd_01/agent-workspaces/aws_01/files/docs/with%20space.md",
      options: {
        headers: {
          "X-Visboard-Run-Id": access.run_id,
          "X-Visboard-Lease-Id": access.lease_id,
        },
      },
    });
    const url = client.calls[0]?.path ?? "";
    expect(url).not.toContain("run_id=");
    expect(url).not.toContain("lease_id=");

    await transport.listFiles({
      board_id: "brd_01",
      agent_workspace_id: "aws_01",
      access,
    });
    const listCall = client.calls[1];
    expect(listCall?.options?.headers).toEqual({
      "X-Visboard-Run-Id": access.run_id,
      "X-Visboard-Lease-Id": access.lease_id,
    });
    const listUrl = `${listCall?.path ?? ""}?${JSON.stringify(listCall?.options?.query ?? {})}`;
    expect(listUrl).not.toMatch(/run_id/);
    expect(listUrl).not.toMatch(/lease_id/);
  });
});
