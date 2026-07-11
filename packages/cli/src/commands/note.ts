import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile as readTemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { createClient, requireWorkspace } from "../client.js";
import { getGlobalOptions } from "../globals.js";
import { formatTable, outputData, outputText } from "../output.js";

export function registerNoteCommands(program: Command): void {
  const note = program.command("note").description("Note commands");

  note
    .command("list")
    .description("List notes in a project")
    .requiredOption("--project <slug>", "project slug")
    .action(async function (this: Command, opts: { project: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const notes = await client.notes.list(ws, opts.project);

      if (globals.json) {
        outputData(notes, globals);
        return;
      }

      outputText(
        formatTable(
          notes.map((n) => ({
            slug: n.slug,
            title: n.title,
            version: n.version,
            id: n.id,
          })),
          ["slug", "title", "version", "id"],
        ),
        globals,
      );
    });

  note
    .command("create")
    .description("Create a note")
    .requiredOption("--project <slug>", "project slug")
    .requiredOption("--title <title>", "note title")
    .option("--slug <slug>", "note slug")
    .option("--file <path>", "read body from file")
    .option("--body <text>", "note body markdown")
    .action(async function (
      this: Command,
      opts: { project: string; title: string; slug?: string; file?: string; body?: string },
    ) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);

      let body = opts.body ?? "";
      if (opts.file) {
        body = await readFile(opts.file, "utf8");
      }

      const created = await client.notes.create(ws, opts.project, {
        title: opts.title,
        slug: opts.slug,
        body,
      });
      outputData(created, globals);
    });

  note
    .command("view")
    .description("View a note")
    .requiredOption("--project <slug>", "project slug")
    .argument("<note-slug>", "note slug or id")
    .action(async function (this: Command, noteSlug: string, opts: { project: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const detail = await client.notes.get(ws, opts.project, noteSlug);

      if (globals.json) {
        outputData(detail, globals);
        return;
      }

      outputText(`# ${detail.title}\n`, globals);
      outputText(detail.body, globals);
    });

  note
    .command("edit")
    .description("Edit a note in $EDITOR")
    .requiredOption("--project <slug>", "project slug")
    .argument("<note-slug>", "note slug or id")
    .action(async function (this: Command, noteSlug: string, opts: { project: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const existing = await client.notes.get(ws, opts.project, noteSlug);

      const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
      const dir = await mkdtemp(path.join(tmpdir(), "visboard-note-"));
      const filePath = path.join(dir, `${existing.slug}.md`);

      try {
        await writeFile(filePath, existing.body, "utf8");
        const result = spawnSync(editor, [filePath], { stdio: "inherit" });
        if (result.status !== 0) {
          throw new Error(`Editor exited with code ${result.status ?? "unknown"}`);
        }

        const updatedBody = await readTemp(filePath, "utf8");
        const updated = await client.notes.update(
          ws,
          opts.project,
          noteSlug,
          { body: updatedBody },
          `W/"${existing.version}"`,
        );
        outputData(updated, globals);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

  note
    .command("delete")
    .description("Delete a note")
    .requiredOption("--project <slug>", "project slug")
    .argument("<note-slug>", "note slug or id")
    .action(async function (this: Command, noteSlug: string, opts: { project: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      await client.notes.delete(ws, opts.project, noteSlug);
      outputText(`Deleted note: ${noteSlug}`, globals);
    });
}
