import { describe, expect, it } from "vitest";
import { badRequest, foreignKeyReferenceDetail, isForeignKeyViolation, notFound } from "./errors.js";
import { rethrowAsNotFoundIfForeignKey } from "./json.js";

describe("isForeignKeyViolation", () => {
  it("detects a pg-style error with SQLSTATE 23503", () => {
    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
  });

  it("detects wrapped errors via cause chains", () => {
    expect(isForeignKeyViolation(new Error("query failed", { cause: { code: "23503" } }))).toBe(
      true,
    );
  });

  it("ignores other database errors so real 500s surface", () => {
    expect(isForeignKeyViolation({ code: "23505" })).toBe(false);
    expect(isForeignKeyViolation(new Error("boom"))).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});

describe("foreignKeyReferenceDetail", () => {
  it("names the referenced entity from the constraint name", () => {
    expect(foreignKeyReferenceDetail({ constraint_name: "agent_runs_agent_id_fkey" })).toBe(
      "agent",
    );
    expect(foreignKeyReferenceDetail({ constraint: "handoffs_agent_workspace_id_fkey" })).toBe(
      "workspace",
    );
  });

  it("returns null when no constraint information is available", () => {
    expect(foreignKeyReferenceDetail(new Error("nope"))).toBeNull();
  });
});

describe("rethrowAsNotFoundIfForeignKey", () => {
  it("maps an unknown referenced agent to a 404 naming the agent", () => {
    const error = Object.assign(new Error("insert violates foreign key constraint"), {
      code: "23503",
      constraint_name: "agent_runs_agent_id_fkey",
    });
    expect(() => rethrowAsNotFoundIfForeignKey(error)).toThrowError(
      expect.objectContaining({ status: 404 }),
    );
    try {
      rethrowAsNotFoundIfForeignKey(error);
      expect.unreachable();
    } catch (mapped) {
      expect((mapped as ReturnType<typeof notFound>).detail).toContain("agent");
    }
  });

  it("leaves logic bugs untouched so they still surface as 500s", () => {
    expect(() => rethrowAsNotFoundIfForeignKey(new TypeError("undefined is not a function")))
      .not.toThrow();
    expect(() => rethrowAsNotFoundIfForeignKey(badRequest("already an api error"))).not.toThrow();
  });
});
