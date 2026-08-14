import { describe, expect, it, vi } from "vitest";
import { AutomationEngine, createSignedWebhookExecutor } from "./automation.js";

const event = {
  id: "evt_1",
  type: "kanban.card.transitioned",
  workspace_id: "ws_1",
  board_id: "brd_1",
  effect_generation: 2,
  source: "human" as const,
  payload: { to_state: "done" },
  created_at: "2026-07-21T12:00:00.000Z",
};

describe("AutomationEngine", () => {
  it("matches committed semantic events, honors dependencies, and deduplicates runs", async () => {
    const calls: string[] = [];
    const engine = new AutomationEngine({
      executors: {
        notify: async ({ action }) => {
          calls.push(action.id);
          return { notified: true };
        },
        export: async ({ action }) => {
          calls.push(action.id);
          return { exported: true };
        },
      },
    });
    engine.createRule({
      id: "auto_1",
      workspace_id: "ws_1",
      board_id: "brd_1",
      name: "Done notification",
      enabled: true,
      trigger: {
        event_types: ["kanban.card.transitioned"],
        conditions: [{ path: "payload.to_state", operator: "equals", value: "done" }],
      },
      actions: [
        { id: "notify", type: "notify" },
        { id: "export", type: "export", depends_on: ["notify"] },
      ],
    });

    const [first] = await engine.processEvent(event);
    const [duplicate] = await engine.processEvent(event);
    expect(first?.state).toBe("succeeded");
    expect(calls).toEqual(["notify", "export"]);
    expect(duplicate?.id).toBe(first?.id);
    expect(calls).toEqual(["notify", "export"]);
  });

  it("holds effectful actions for a human approval and then executes with a fresh action state", async () => {
    const executor = vi.fn(async () => ({ delivered: true }));
    const engine = new AutomationEngine({ executors: { webhook: executor } });
    engine.createRule({
      id: "auto_approval",
      workspace_id: "ws_1",
      name: "Deploy gate",
      enabled: true,
      trigger: { event_types: [event.type] },
      actions: [{ id: "deploy", type: "webhook", requires_approval: true }],
    });
    const [pending] = await engine.processEvent(event);
    expect(pending?.state).toBe("awaiting_approval");
    expect(executor).not.toHaveBeenCalled();

    if (!pending) throw new Error("expected pending automation run");
    const approved = await engine.approveAction(pending.id, "deploy", event);
    expect(approved?.state).toBe("succeeded");
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("blocks actions when the board effect fence has changed", async () => {
    const executor = vi.fn(async () => ({}));
    const engine = new AutomationEngine({
      executors: { notify: executor },
      getEffectGeneration: async () => 3,
    });
    engine.createRule({
      id: "auto_fence",
      workspace_id: "ws_1",
      board_id: "brd_1",
      name: "Fenced rule",
      enabled: true,
      trigger: { event_types: [event.type] },
      actions: [{ id: "notify", type: "notify" }],
    });
    const [run] = await engine.processEvent(event);
    expect(run?.state).toBe("blocked");
    expect(run?.actions[0]?.error).toContain("effect generation");
    expect(executor).not.toHaveBeenCalled();
  });

  it("rejects unsafe cyclic action dependencies at rule creation", () => {
    const engine = new AutomationEngine();
    expect(() =>
      engine.createRule({
        id: "auto_cycle",
        workspace_id: "ws_1",
        name: "Cycle",
        enabled: false,
        trigger: { event_types: [event.type] },
        actions: [
          { id: "a", type: "notify", depends_on: ["b"] },
          { id: "b", type: "notify", depends_on: ["a"] },
        ],
      }),
    ).toThrow("cycle");
  });
});

describe("signed webhook action", () => {
  it("uses an allow-list and sends a signed idempotent request", async () => {
    const fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof globalThis.fetch;
    const executor = createSignedWebhookExecutor({
      fetch,
      allowedHosts: ["hooks.example.com"],
      resolveSecret: async () => "signing-secret",
    });
    await executor({
      action: {
        id: "hook",
        type: "webhook",
        config: { url: "https://hooks.example.com/visboard", secret_reference: "vault://hook" },
        depends_on: [],
        dependency_mode: "after_success",
        requires_approval: false,
        timeout_ms: 5_000,
        max_attempts: 1,
      },
      rule: {
        id: "auto_hook",
        workspace_id: "ws_1",
        name: "Hook",
        version: 1,
        enabled: true,
        trigger: {
          event_types: [event.type],
          conditions: [],
          allow_self_trigger: false,
          maximum_causation_depth: 4,
        },
        idempotency_key_template: "event.id",
        cooldown_ms: 0,
        actions: [],
      },
      run: {
        id: "arun_1",
        rule_id: "auto_hook",
        rule_version: 1,
        event_id: event.id,
        board_id: "brd_1",
        effect_generation: 2,
        idempotency_key: event.id,
        state: "running",
        actions: [],
        created_at: event.created_at,
        updated_at: event.created_at,
      },
      event,
      idempotencyKey: "delivery-1",
      causationDepth: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        "Idempotency-Key": "delivery-1",
        "X-VisBoard-Signature-256": expect.stringMatching(/^sha256=/),
      }),
    });
  });

  it("rejects an unsafe webhook destination", async () => {
    const executor = createSignedWebhookExecutor({
      allowedHosts: ["hooks.example.com"],
      resolveSecret: async () => "secret",
    });
    await expect(
      executor({
        action: {
          id: "unsafe",
          type: "webhook",
          config: { url: "https://127.0.0.1/hook", secret_reference: "vault://hook" },
          depends_on: [],
          dependency_mode: "after_success",
          requires_approval: false,
          timeout_ms: 5_000,
          max_attempts: 1,
        },
        rule: {
          id: "auto_hook",
          workspace_id: "ws_1",
          name: "Hook",
          version: 1,
          enabled: true,
          trigger: {
            event_types: [event.type],
            conditions: [],
            allow_self_trigger: false,
            maximum_causation_depth: 4,
          },
          idempotency_key_template: "event.id",
          cooldown_ms: 0,
          actions: [],
        },
        run: {
          id: "arun_1",
          rule_id: "auto_hook",
          rule_version: 1,
          event_id: event.id,
          board_id: "brd_1",
          effect_generation: 2,
          idempotency_key: event.id,
          state: "running",
          actions: [],
          created_at: event.created_at,
          updated_at: event.created_at,
        },
        event,
        idempotencyKey: "delivery-1",
        causationDepth: 1,
      }),
    ).rejects.toThrow("not allowed");
  });
});
