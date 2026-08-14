import { createId } from "@visboard/shared";
import type {
  BoardInterchangeDocument,
  InterchangeBlock,
  LossinessEntry,
  LossinessReport,
  MarkdownImportDocument,
} from "@visboard/shared";
import {
  boardInterchangeDocumentSchema,
  lossinessReportSchema,
  markdownImportDocumentSchema,
} from "@visboard/shared";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SECRET_KEY =
  /(?:^|_)(?:secret|token|password|credential|authorization|api_key|refresh_token)(?:$|_)/i;
const SECRET_REFERENCE_KEY =
  /(?:secret|token|credential).*(?:ref|reference|handle)|(?:ref|reference|handle).*(?:secret|token|credential)/i;

function redactSecrets(value: unknown, path: string, entries: LossinessEntry[]): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactSecrets(entry, `${path}[${index}]`, entries));
  }
  if (!isRecord(value)) return value;

  const safe: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key) && !SECRET_REFERENCE_KEY.test(key)) {
      safe[key] = "[REDACTED]";
      entries.push({
        code: "secret_redacted",
        path: childPath,
        message: "Sensitive credential material is excluded from interchange exports.",
      });
      continue;
    }
    safe[key] = redactSecrets(child, childPath, entries);
  }
  return safe;
}

function sanitizedState(state: BoardStateForInterchange): {
  state: BoardStateForInterchange;
  entries: LossinessEntry[];
} {
  const entries: LossinessEntry[] = [];
  return {
    state: {
      board: redactSecrets(state.board, "board", entries) as JsonRecord,
      document: state.document
        ? (redactSecrets(state.document, "document", entries) as JsonRecord)
        : null,
      blocks: redactSecrets(state.blocks, "blocks", entries) as InterchangeBlock[],
      head_revision: state.head_revision
        ? (redactSecrets(state.head_revision, "revision", entries) as JsonRecord)
        : null,
      extensions: redactSecrets(state.extensions ?? {}, "extensions", entries) as JsonRecord,
    },
    entries,
  };
}

function encodeMarker(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeMarker(marker: string): unknown {
  return JSON.parse(Buffer.from(marker, "base64url").toString("utf8"));
}

function markdownEscaped(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function blockTitle(block: InterchangeBlock): string {
  const attributes = asRecord(block.attributes);
  const content = asRecord(block.content);
  return asString(attributes.title) ?? asString(content.title) ?? `${block.type} (${block.id})`;
}

function blockText(block: InterchangeBlock): string | null {
  const content = asRecord(block.content);
  const attributes = asRecord(block.attributes);
  return (
    asString(content.markdown) ??
    asString(content.body) ??
    asString(content.text) ??
    asString(attributes.markdown) ??
    asString(attributes.body)
  );
}

function sourceForBlock(block: InterchangeBlock): string | null {
  const content = asRecord(block.content);
  const attributes = asRecord(block.attributes);
  return asString(content.source) ?? asString(attributes.source);
}

function blockMarkdown(block: InterchangeBlock): string {
  const title = blockTitle(block);
  const marker = `<!-- visboard:block ${encodeMarker(block)} -->`;
  const prefix = `${marker}\n\n## ${title}\n\n`;
  const source = sourceForBlock(block);
  const attributes = asRecord(block.attributes);
  const content = asRecord(block.content);

  if (block.type === "core.mermaid" && source !== null) {
    return `${prefix}\`\`\`mermaid\n${markdownEscaped(source)}\n\`\`\``;
  }
  if (block.type === "core.code" && source !== null) {
    const language = asString(attributes.language) ?? asString(content.language) ?? "text";
    return `${prefix}\`\`\`${language}\n${markdownEscaped(source)}\n\`\`\``;
  }
  if (block.type === "core.kanban") {
    const columns = Array.isArray(attributes.columns)
      ? attributes.columns
      : Array.isArray(content.columns)
        ? content.columns
        : [];
    const cards = Array.isArray(attributes.cards)
      ? attributes.cards
      : Array.isArray(content.cards)
        ? content.cards
        : [];
    const columnNames = columns
      .map((column) => asString(asRecord(column).title) ?? asString(asRecord(column).name))
      .filter((name): name is string => Boolean(name));
    const cardRows = cards.map((card) => {
      const record = asRecord(card);
      return `| ${asString(record.title) ?? "Untitled"} | ${asString(record.lane) ?? asString(record.state) ?? ""} |`;
    });
    const table = [
      columnNames.length ? `Columns: ${columnNames.join(", ")}` : "",
      "| Card | Lane |",
      "| --- | --- |",
      ...cardRows,
    ]
      .filter(Boolean)
      .join("\n");
    return `${prefix}${table}`;
  }
  if (block.type === "core.dashboard") {
    const snapshot = asRecord(content.snapshot);
    const description = asString(attributes.description) ?? asString(content.description);
    const snapshotLine = Object.keys(snapshot).length
      ? `\n\n_Data snapshot available: ${Object.keys(snapshot).length} fields._`
      : "";
    return `${prefix}${description ?? "Dashboard configuration is preserved in the VisBoard marker."}${snapshotLine}`;
  }

  const text = blockText(block);
  if (text !== null) return `${prefix}${markdownEscaped(text)}`;
  return `${prefix}_This ${block.type} block has no canonical narrative body. Its portable metadata is stored in the VisBoard marker above._`;
}

function markdownLossiness(): LossinessReport {
  const entries: LossinessEntry[] = [
    {
      code: "collaboration_state_omitted",
      path: "document",
      message: "Markdown does not preserve live CRDT updates, cursors, or presence.",
    },
    {
      code: "revision_history_omitted",
      path: "revision",
      message: "Markdown carries the selected revision anchor but not complete revision history.",
    },
  ];
  return { format: "markdown", lossless: false, entries };
}

export interface BoardStateForInterchange {
  board: JsonRecord;
  document?: JsonRecord | null;
  blocks: readonly InterchangeBlock[];
  head_revision?: JsonRecord | null;
  /** Template, sync link, and other portable non-secret metadata. */
  extensions?: JsonRecord;
}

export interface JsonExportOptions {
  exportedAt?: Date;
  lossinessReport?: LossinessReport;
}

/** Creates the portable V3 JSON envelope without relying on database schemas. */
export function exportBoardJson(
  state: BoardStateForInterchange,
  options: JsonExportOptions = {},
): BoardInterchangeDocument {
  const sanitized = sanitizedState(state);
  const suppliedReport = options.lossinessReport;
  const lossinessReport: LossinessReport = {
    format: "json",
    lossless: (suppliedReport?.lossless ?? true) && sanitized.entries.length === 0,
    entries: [...(suppliedReport?.entries ?? []), ...sanitized.entries],
  };
  const document = {
    format: "visboard-board-json" as const,
    version: 3 as const,
    exported_at: (options.exportedAt ?? new Date()).toISOString(),
    board: clone(sanitized.state.board),
    document: sanitized.state.document ? clone(sanitized.state.document) : null,
    revision: sanitized.state.head_revision ? clone(sanitized.state.head_revision) : null,
    blocks: sanitized.state.blocks.map(clone),
    extensions: clone(sanitized.state.extensions ?? {}),
    lossiness_report: lossinessReport,
  };
  return boardInterchangeDocumentSchema.parse(document);
}

export function serializeBoardJson(
  state: BoardStateForInterchange,
  options: JsonExportOptions = {},
): string {
  return `${JSON.stringify(exportBoardJson(state, options), null, 2)}\n`;
}

/**
 * Markdown stays pleasant to read while comment markers preserve every known
 * block envelope for a safe re-import. Non-VisBoard Markdown remains importable
 * as a document block by `importBoardMarkdown`.
 */
export function exportBoardMarkdown(state: BoardStateForInterchange): string {
  const sanitized = sanitizedState(state);
  const markdownReport: LossinessReport = {
    ...markdownLossiness(),
    entries: [...markdownLossiness().entries, ...sanitized.entries],
  };
  const boardTitle =
    asString(sanitized.state.board.name) ??
    asString(sanitized.state.board.title) ??
    "VisBoard export";
  const header = [
    "---",
    "visboard_format: visboard-board-markdown",
    "version: 3",
    `board_id: ${asString(sanitized.state.board.id) ?? ""}`,
    `title: ${JSON.stringify(boardTitle)}`,
    "---",
    "",
    `<!-- visboard:board ${encodeMarker(sanitized.state.board)} -->`,
    `<!-- visboard:extensions ${encodeMarker(sanitized.state.extensions ?? {})} -->`,
    `<!-- visboard:lossiness ${encodeMarker(markdownReport)} -->`,
    "",
    `# ${boardTitle}`,
    "",
  ];
  return `${header.join("\n")}${sanitized.state.blocks.map(blockMarkdown).join("\n\n")}\n`;
}

function extractMarkers(
  markdown: string,
  name: "board" | "block" | "extensions" | "lossiness",
): unknown[] {
  const expression = new RegExp(`<!--\\s*visboard:${name}\\s+([A-Za-z0-9_-]+)\\s*-->`, "g");
  const values: unknown[] = [];
  for (const match of markdown.matchAll(expression)) {
    const marker = match[1];
    if (!marker) continue;
    try {
      values.push(decodeMarker(marker));
    } catch {
      // Ignore malformed optional metadata markers; they should not turn a
      // human-authored Markdown import into a parser crash.
    }
  }
  return values;
}

function frontmatterTitle(markdown: string): string | null {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match?.[1]) return null;
  const title = match[1].match(/^title:\s*(.+)$/m)?.[1]?.trim();
  if (!title) return null;
  try {
    return JSON.parse(title) as string;
  } catch {
    return title.replace(/^['"]|['"]$/g, "");
  }
}

export function importBoardMarkdown(markdown: string): MarkdownImportDocument {
  const board = asRecord(extractMarkers(markdown, "board")[0]);
  const extensions = asRecord(extractMarkers(markdown, "extensions")[0]);
  const markedBlocks = extractMarkers(markdown, "block")
    .filter(isRecord)
    .flatMap((block) => {
      const parsed = boardInterchangeDocumentSchema.shape.blocks.element.safeParse(block);
      return parsed.success ? [clone(parsed.data)] : [];
    });
  const markedReport = lossinessReportSchema.safeParse(extractMarkers(markdown, "lossiness")[0]);

  const normalizedBoard =
    Object.keys(board).length > 0
      ? board
      : { name: frontmatterTitle(markdown) ?? "Imported Markdown board" };
  const blocks =
    markedBlocks.length > 0
      ? markedBlocks
      : [
          {
            id: createId("blk"),
            type: "core.document",
            schema_version: 1,
            attributes: { title: frontmatterTitle(markdown) ?? "Imported Markdown" },
            content: { markdown },
          },
        ];

  return markdownImportDocumentSchema.parse({
    format: "visboard-board-markdown",
    version: 3,
    board: normalizedBoard,
    blocks,
    extensions,
    lossiness_report: markedReport.success ? markedReport.data : markdownLossiness(),
  });
}

export function parseBoardJson(json: string | unknown): BoardInterchangeDocument {
  const value = typeof json === "string" ? JSON.parse(json) : json;
  return boardInterchangeDocumentSchema.parse(value);
}

export type ImportedBoard =
  | { format: "json"; document: BoardInterchangeDocument }
  | { format: "markdown"; document: MarkdownImportDocument };

export function importBoardInterchange(content: string, contentType?: string): ImportedBoard {
  const trimmed = content.trimStart();
  if (contentType?.includes("json") || trimmed.startsWith("{")) {
    return { format: "json", document: parseBoardJson(content) };
  }
  return { format: "markdown", document: importBoardMarkdown(content) };
}
