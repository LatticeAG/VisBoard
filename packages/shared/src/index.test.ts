import { describe, expect, it } from "vitest";
import {
  createPrefixedId,
  createWorkspaceSchema,
  hasScope,
  isValidId,
  Scope,
  slugSchema,
} from "./index.js";

describe("ids", () => {
  it("creates prefixed ULIDs", () => {
    const id = createPrefixedId("workspace");
    expect(id.startsWith("ws_")).toBe(true);
    expect(isValidId(id, "workspace")).toBe(true);
  });

  it("rejects invalid workspace IDs", () => {
    expect(isValidId("ws_bad", "workspace")).toBe(false);
    expect(isValidId("prj_01ARZ3NDEKTSV4RRFFQ69G5FAV", "workspace")).toBe(false);
  });
});

describe("slugSchema", () => {
  it("accepts valid slugs", () => {
    expect(slugSchema.safeParse("acme-corp").success).toBe(true);
    expect(slugSchema.safeParse("a1b").success).toBe(true);
  });

  it("rejects invalid slugs", () => {
    expect(slugSchema.safeParse("ab").success).toBe(false);
    expect(slugSchema.safeParse("Acme").success).toBe(false);
    expect(slugSchema.safeParse("bad_slug").success).toBe(false);
  });
});

describe("createWorkspaceSchema", () => {
  it("requires name", () => {
    expect(createWorkspaceSchema.safeParse({}).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: "Acme" }).success).toBe(true);
  });

  it("validates optional slug", () => {
    expect(createWorkspaceSchema.safeParse({ name: "Acme", slug: "ACME" }).success).toBe(false);
    expect(createWorkspaceSchema.safeParse({ name: "Acme", slug: "acme" }).success).toBe(true);
  });
});

describe("scopes", () => {
  it("expands admin to all scopes", () => {
    expect(hasScope([Scope.ADMIN], Scope.WRITE_FILES)).toBe(true);
    expect(hasScope([Scope.ADMIN], Scope.READ)).toBe(true);
  });

  it("does not grant write without explicit scope", () => {
    expect(hasScope([Scope.READ], Scope.WRITE_NOTES)).toBe(false);
  });
});
