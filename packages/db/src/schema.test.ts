import { describe, expect, it } from "vitest";
import * as schema from "./schema/index";

const EXPECTED_TABLES = [
  "workspaces",
  "users",
  "workspaceMembers",
  "personalAccessTokens",
  "projects",
  "projectMembers",
  "notes",
  "noteVersions",
  "checklists",
  "checklistItems",
  "files",
  "agents",
  "events",
  "boards",
  "boardDocuments",
  "boardBlocks",
  "boardRevisions",
  "boardEvents",
  "boardTemplates",
  "templateVersions",
  "templateInstallations",
  "templateBlockMappings",
] as const;

describe("schema exports", () => {
  it("exports all expected tables", () => {
    for (const table of EXPECTED_TABLES) {
      expect(schema).toHaveProperty(table);
      expect(schema[table as keyof typeof schema]).toBeDefined();
    }
  });
});
