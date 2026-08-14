import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPE_REGISTRY,
  BUILT_IN_TEMPLATES,
  Scope,
  createBoardBlockSchema,
  createPrefixedId,
  createWorkspaceSchema,
  hasScope,
  isValidId,
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

  it("creates and validates V3 board IDs", () => {
    const id = createPrefixedId("board");
    expect(id.startsWith("brd_")).toBe(true);
    expect(isValidId(id, "board")).toBe(true);
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

describe("V3 block registry and templates", () => {
  it("publishes rich core block definitions", () => {
    for (const type of [
      "core.kanban",
      "core.mermaid",
      "core.code",
      "core.embed",
      "core.dashboard",
    ] as const) {
      expect(BLOCK_TYPE_REGISTRY[type]).toBeDefined();
    }
  });

  it("validates a rich block payload and preserves collaborative source", () => {
    const parsed = createBoardBlockSchema.parse({
      type: "core.mermaid",
      content: { source: "graph TD\\nA --> B" },
      attributes: { accessibility_description: "A flows to B" },
    });
    expect(parsed.schema_version).toBe(1);
    expect(parsed.content.source).toContain("graph TD");
  });

  it("ships reusable built-in working protocols", () => {
    expect(BUILT_IN_TEMPLATES.map((template) => template.slug)).toEqual([
      "sprint-planning",
      "incident-response",
      "pr-review",
      "research",
    ]);
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.manifest.blocks.length).toBeGreaterThan(0);
    }
  });
});
