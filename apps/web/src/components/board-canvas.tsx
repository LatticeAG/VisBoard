"use client";

import type { BoardBlock } from "@visboard/sdk";
import { MarkdownPreview } from "./markdown-preview";

interface BoardCanvasProps {
  blocks: BoardBlock[];
  selectedBlockId?: string | null;
  onSelectBlock?: (block: BoardBlock) => void;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textFrom(block: BoardBlock): string {
  const candidates = [
    block.content.body,
    block.content.source,
    block.content.text,
    block.attributes.body,
    block.attributes.source,
    block.attributes.text,
  ];
  const found = candidates.find((value) => typeof value === "string");
  return typeof found === "string" ? found : "";
}

function titleFrom(block: BoardBlock): string {
  const candidates = [block.attributes.title, block.content.title, block.type];
  const found = candidates.find((value) => typeof value === "string");
  return typeof found === "string" ? found : block.type;
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function KanbanBlock({ block }: { block: BoardBlock }) {
  const columns = recordArray(block.attributes.columns ?? block.content.columns);
  const cards = recordArray(block.attributes.cards ?? block.content.cards);

  if (columns.length === 0) {
    return <FallbackBlock block={block} />;
  }

  return (
    <div className="grid min-w-[40rem] grid-flow-col auto-cols-[15rem] gap-3 overflow-x-auto pb-2">
      {columns.map((column, index) => {
        const stateKey = valueText(column.state_key ?? column.id ?? column.key);
        const title = valueText(column.title ?? column.name) || `Column ${index + 1}`;
        const matching = cards.filter(
          (card) => valueText(card.lane_id ?? card.state_key ?? card.column_id) === stateKey,
        );
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: board-canvas.tsx kanban columns lack stable ids in legacy data
          <section key={`${stateKey}-${index}`} className="border border-border bg-bg">
            <header className="border-b border-border px-3 py-2 font-mono text-xs text-muted">
              {title}
              <span className="ml-2 text-accent">{matching.length}</span>
            </header>
            <div className="space-y-2 p-2">
              {matching.map((card, cardIndex) => (
                <article
                  key={valueText(card.id) || `${index}-${cardIndex}`}
                  className="border border-border bg-surface px-3 py-2"
                >
                  <p className="font-mono text-xs text-text">
                    {valueText(card.title ?? card.name) || "Untitled card"}
                  </p>
                  {valueText(card.assignee ?? card.owner) && (
                    <p className="mt-1 font-mono text-[10px] text-muted">
                      {valueText(card.assignee ?? card.owner)}
                    </p>
                  )}
                </article>
              ))}
              {matching.length === 0 && (
                <p className="px-1 py-3 font-mono text-[10px] text-muted">No cards</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MermaidBlock({ block }: { block: BoardBlock }) {
  const source = textFrom(block);
  return (
    <div>
      <p className="mb-2 font-mono text-xs text-muted">Mermaid source</p>
      <pre className="overflow-x-auto border border-border bg-bg p-3 font-mono text-xs leading-5 text-text">
        {source || "No diagram source"}
      </pre>
    </div>
  );
}

function CodeBlock({ block }: { block: BoardBlock }) {
  const language = valueText(block.attributes.language) || "text";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between font-mono text-xs text-muted">
        <span>{language}</span>
        {valueText(block.attributes.preview_profile) && (
          <span>Preview profile: {valueText(block.attributes.preview_profile)}</span>
        )}
      </div>
      <pre className="overflow-x-auto border border-border bg-bg p-3 font-mono text-xs leading-5 text-text">
        {textFrom(block) || "No source"}
      </pre>
    </div>
  );
}

function EmbedBlock({ block }: { block: BoardBlock }) {
  const url = valueText(block.attributes.url ?? block.content.url);
  const safeUrl = url.startsWith("https://") || url.startsWith("http://") ? url : null;
  return (
    <div className="border border-border bg-bg p-3">
      <p className="font-mono text-xs text-text">{titleFrom(block)}</p>
      {safeUrl ? (
        <a
          href={safeUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block font-mono text-xs text-accent hover:underline"
        >
          Open approved embed
        </a>
      ) : (
        <p className="mt-2 font-mono text-xs text-muted">No approved URL configured</p>
      )}
    </div>
  );
}

function DashboardBlock({ block }: { block: BoardBlock }) {
  const metrics = recordArray(block.content.metrics ?? block.attributes.metrics);
  if (metrics.length === 0) return <FallbackBlock block={block} />;

  return (
    <dl className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
      {metrics.map((metric, index) => (
        <div key={valueText(metric.key) || `${index}`} className="bg-surface px-3 py-3">
          <dt className="font-mono text-[10px] uppercase tracking-wide text-muted">
            {valueText(metric.label ?? metric.key) || "Metric"}
          </dt>
          <dd className="mt-2 font-mono text-lg text-text">
            {valueText(metric.value) || "Unavailable"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FallbackBlock({ block }: { block: BoardBlock }) {
  const text = textFrom(block);
  return text ? (
    <MarkdownPreview content={text} className="max-h-80 p-0" />
  ) : (
    <pre className="max-h-80 overflow-auto border border-border bg-bg p-3 font-mono text-xs text-muted">
      {JSON.stringify({ attributes: block.attributes, content: block.content }, null, 2)}
    </pre>
  );
}

function BlockBody({ block }: { block: BoardBlock }) {
  switch (block.type) {
    case "core.kanban":
      return <KanbanBlock block={block} />;
    case "core.mermaid":
      return <MermaidBlock block={block} />;
    case "core.code":
      return <CodeBlock block={block} />;
    case "core.embed":
      return <EmbedBlock block={block} />;
    case "core.dashboard":
      return <DashboardBlock block={block} />;
    default:
      return <FallbackBlock block={block} />;
  }
}

/** Permission-safe block renderer: embeds remain links and Mermaid is source-only. */
export function BoardCanvas({ blocks, selectedBlockId, onSelectBlock }: BoardCanvasProps) {
  if (blocks.length === 0) {
    return (
      <div className="flex min-h-64 items-center justify-center border border-dashed border-border p-6 font-mono text-sm text-muted">
        This board has no blocks yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {blocks.map((block) => (
        <article
          key={block.id}
          className={`border bg-surface ${selectedBlockId === block.id ? "border-accent" : "border-border"}`}
        >
          <button
            type="button"
            onClick={() => onSelectBlock?.(block)}
            className="flex w-full items-center justify-between border-b border-border px-4 py-2 text-left hover:bg-bg"
          >
            <span className="font-mono text-sm text-text">{titleFrom(block)}</span>
            <span className="font-mono text-[10px] text-muted">{block.type}</span>
          </button>
          <div className="overflow-x-auto p-4">
            <BlockBody block={block} />
          </div>
        </article>
      ))}
    </div>
  );
}
