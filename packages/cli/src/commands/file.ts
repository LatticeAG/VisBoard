import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Command } from "commander";
import { createClient, requireWorkspace } from "../client.js";
import { getGlobalOptions } from "../globals.js";
import { formatTable, outputData, outputText } from "../output.js";

export function registerFileCommands(program: Command): void {
  const file = program.command("file").description("File commands");

  file
    .command("upload")
    .description("Upload a file to a project")
    .requiredOption("--project <slug>", "project slug")
    .argument("<path>", "local file path")
    .action(async function (this: Command, filePath: string, opts: { project: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);

      const content = await readFile(filePath);
      const filename = path.basename(filePath);
      const blob = new Blob([content]);

      const uploaded = await client.files.upload(ws, opts.project, {
        file: blob,
        filename,
      });
      outputData(uploaded, globals);
    });

  file
    .command("list")
    .description("List files in a project")
    .requiredOption("--project <slug>", "project slug")
    .action(async function (this: Command, opts: { project: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const files = await client.files.list(ws, opts.project);

      if (globals.json) {
        outputData(files, globals);
        return;
      }

      outputText(
        formatTable(
          files.map((f) => ({
            id: f.id,
            name: f.name,
            mime_type: f.mime_type,
            size_bytes: f.size_bytes,
          })),
          ["id", "name", "mime_type", "size_bytes"],
        ),
        globals,
      );
    });

  file
    .command("download")
    .description("Download a file")
    .requiredOption("--project <slug>", "project slug")
    .argument("<file-id>", "file id")
    .option("--out <dir>", "output directory", ".")
    .action(async function (this: Command, fileId: string, opts: { project: string; out: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);

      const meta = await client.files.get(ws, opts.project, fileId);
      const response = await client.files.download(ws, opts.project, fileId);

      await mkdir(opts.out, { recursive: true });
      const outPath = path.join(opts.out, meta.name);

      if (response.body) {
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(outPath));
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        await import("node:fs/promises").then((fs) => fs.writeFile(outPath, buffer));
      }

      outputText(`Downloaded to ${outPath}`, globals);
    });

  file
    .command("delete")
    .description("Delete a file")
    .requiredOption("--project <slug>", "project slug")
    .argument("<file-id>", "file id")
    .action(async function (this: Command, fileId: string, opts: { project: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      await client.files.delete(ws, opts.project, fileId);
      outputText(`Deleted file: ${fileId}`, globals);
    });
}
