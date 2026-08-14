export interface GlobalOptions {
  json?: boolean;
  quiet?: boolean;
  endpoint?: string;
  workspace?: string;
}

export function outputData(data: unknown, options: GlobalOptions): void {
  if (options.quiet) return;
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (typeof data === "string") {
    console.log(data);
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

export function outputText(text: string, options: GlobalOptions): void {
  if (options.quiet || options.json) return;
  console.log(text);
}

export function outputError(message: string, options: GlobalOptions): void {
  console.error(message);
  if (!options.quiet) {
    // errors always shown
  }
}

export function formatTable(rows: Record<string, unknown>[], columns: string[]): string {
  if (rows.length === 0) return "(none)";
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((row) => String(row[col] ?? "").length)),
  );
  const header = columns.map((col, i) => col.padEnd(widths[i] ?? col.length)).join("  ");
  const divider = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map((row) =>
      columns.map((col, i) => String(row[col] ?? "").padEnd(widths[i] ?? col.length)).join("  "),
    )
    .join("\n");
  return `${header}\n${divider}\n${body}`;
}
