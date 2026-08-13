import { describe, expect, it } from "vitest";
import {
  exportBoardJson,
  exportBoardMarkdown,
  importBoardInterchange,
  importBoardMarkdown,
  parseBoardJson,
} from "./board-interchange.js";

const state = {
  board: { id: "brd_1", name: "Launch board", slug: "launch" },
  document: { id: "bdoc_1", epoch: 1 },
  head_revision: { id: "rev_1", revision_number: 1 },
  extensions: { sync_links: [{ external_id: "acme/repo#7" }] },
  blocks: [
    {
      id: "blk_doc",
      type: "core.document",
      schema_version: 1,
      attributes: { title: "Plan" },
      content: { markdown: "# Plan\nShip safely." },
    },
    {
      id: "blk_mermaid",
      type: "core.mermaid",
      schema_version: 1,
      attributes: { title: "Flow" },
      content: { source: "flowchart LR\nA-->B" },
    },
    {
      id: "blk_unknown",
      type: "acme.custom",
      schema_version: 4,
      custom_configuration: { retained: true },
    },
  ],
};

describe("board interchange", () => {
  it("round-trips the JSON envelope while retaining unknown block data", () => {
    const exported = exportBoardJson(state, {
      exportedAt: new Date("2026-07-21T12:00:00.000Z"),
    });
    const parsed = parseBoardJson(JSON.stringify(exported));
    expect(parsed.format).toBe("visboard-board-json");
    expect(parsed.lossiness_report.lossless).toBe(true);
    expect(parsed.blocks[2]).toMatchObject({
      type: "acme.custom",
      custom_configuration: { retained: true },
    });
    expect(parsed.extensions).toEqual(state.extensions);
  });

  it("writes readable Markdown with portable block markers and reimports it", () => {
    const markdown = exportBoardMarkdown(state);
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("# Launch board");
    const imported = importBoardMarkdown(markdown);
    expect(imported.blocks).toHaveLength(3);
    expect(imported.blocks[1]).toMatchObject({ id: "blk_mermaid", type: "core.mermaid" });
    expect(imported.lossiness_report.lossless).toBe(false);
  });

  it("imports ordinary Markdown as a document block and auto-detects JSON", () => {
    const markdown = importBoardInterchange("# A plain note\n\nUseful context.");
    expect(markdown.format).toBe("markdown");
    if (markdown.format === "markdown") {
      expect(markdown.document.blocks[0]).toMatchObject({ type: "core.document" });
    }

    const json = importBoardInterchange(JSON.stringify(exportBoardJson(state)));
    expect(json.format).toBe("json");
  });

  it("redacts credential material while retaining secret references", () => {
    const exported = exportBoardJson({
      ...state,
      extensions: {
        api_token: "do-not-export",
        secret_reference: "vault://visboard/export",
      },
    });
    expect(exported.extensions.api_token).toBe("[REDACTED]");
    expect(exported.extensions.secret_reference).toBe("vault://visboard/export");
    expect(exported.lossiness_report.lossless).toBe(false);
  });
});
