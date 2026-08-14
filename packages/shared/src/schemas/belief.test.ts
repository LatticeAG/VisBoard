import { describe, expect, it } from "vitest";
import { beliefTraceSchema } from "./belief.js";

describe("beliefTraceSchema", () => {
  const valid = {
    schema_version: 1 as const,
    board_revision_id: null,
    run_id: "arun_test",
    captured_at: "2026-08-14T04:00:00.000Z",
    summary: "Ready",
    beliefs: [{ id: "b1", statement: "Isolation holds" }],
    assumptions: [],
    overweighted: [],
    ignored: [],
    confidence: 0.5,
  };

  it("accepts a compact trace", () => {
    expect(beliefTraceSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a trace larger than 64 KiB", () => {
    const huge = {
      ...valid,
      summary: "x".repeat(4000),
      beliefs: Array.from({ length: 32 }, (_, i) => ({
        id: `b${i}`,
        statement: "s".repeat(2000),
      })),
      assumptions: Array.from({ length: 32 }, (_, i) => ({
        id: `a${i}`,
        statement: "s".repeat(2000),
      })),
    };
    const parsed = beliefTraceSchema.safeParse(huge);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.message === "belief_trace exceeds 64 KiB"),
      ).toBe(true);
    }
  });
});
