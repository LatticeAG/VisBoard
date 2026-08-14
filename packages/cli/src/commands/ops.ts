import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Command } from "commander";
import { createClient, requireWorkspace } from "../client.js";
import { loadConfig } from "../config.js";
import { getGlobalOptions } from "../globals.js";
import { outputData, outputText } from "../output.js";

async function waitForExport(
  client: Awaited<ReturnType<typeof createClient>>["client"],
  ws: string,
  exportId: string,
  maxAttempts = 30,
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await client.workspaces.getExport(ws, exportId);
      if (response.ok && response.headers.get("content-type")?.includes("zip")) {
        return;
      }
    } catch {
      // export not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Export timed out waiting for zip file");
}

export function registerImportCommand(program: Command): void {
  program
    .command("import")
    .description("Import workspace data from an export zip")
    .requiredOption("--file <path>", "export zip path")
    .requiredOption("--slug <slug>", "new workspace slug")
    .option("--name <name>", "new workspace name")
    .action(async function (this: Command, opts: { file: string; slug: string; name?: string }) {
      const globals = getGlobalOptions(this);
      const { client } = await createClient(globals);

      const buffer = await readFile(opts.file);
      const blob = new Blob([buffer], { type: "application/zip" });
      const result = await client.workspaces.import({
        file: blob,
        slug: opts.slug,
        name: opts.name ?? opts.slug,
      });

      outputText(`Imported workspace: ${result.workspace.slug}`, globals);
      outputData(result, globals);
    });
}

export function registerExportCommand(program: Command): void {
  program
    .command("export")
    .description("Export workspace data as zip")
    .option("--out <path>", "output zip path", "./export.zip")
    .action(async function (this: Command, opts: { out: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);

      const job = await client.workspaces.export(ws);
      outputText(`Export started: ${job.export_id}`, globals);

      await waitForExport(client, ws, job.export_id);
      const response = await client.workspaces.getExport(ws, job.export_id);

      if (response.body) {
        await pipeline(Readable.fromWeb(response.body as never), createWriteStream(opts.out));
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        await import("node:fs/promises").then((fs) => fs.writeFile(opts.out, buffer));
      }

      outputText(`Export saved to ${opts.out}`, globals);
      outputData(job, globals);
    });
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check VisBoard connectivity and configuration")
    .action(async function (this: Command) {
      const globals = getGlobalOptions(this);
      const config = await loadConfig();
      const { client } = await createClient(globals);

      const checks: Record<string, unknown> = {
        config_path: (await import("../config.js")).getConfigPath(),
        endpoint: globals.endpoint ?? config.endpoint ?? "http://localhost:8080/v1",
        workspace: globals.workspace ?? config.workspace ?? null,
        has_token: Boolean(config.token),
      };

      try {
        const health = await client.health.check();
        checks.health = health;
        checks.api = "ok";
      } catch (error) {
        checks.api = "error";
        checks.error = error instanceof Error ? error.message : String(error);
      }

      if (config.token && checks.api === "ok") {
        try {
          const ws = globals.workspace ?? config.workspace;
          if (ws) {
            await client.workspaces.get(ws);
            checks.workspace_access = "ok";
          } else {
            await client.workspaces.list();
            checks.workspace_access = "no_default_workspace";
          }
        } catch (error) {
          checks.workspace_access = "error";
          checks.workspace_error = error instanceof Error ? error.message : String(error);
        }
      }

      outputData(checks, globals);
    });
}

export function registerConfigCommands(program: Command): void {
  const configCmd = program.command("config").description("CLI configuration");

  configCmd
    .command("set")
    .description("Set a config value")
    .argument("<key>", "endpoint | workspace | token")
    .argument("<value>", "value to set")
    .action(async function (this: Command, key: string, value: string) {
      const globals = getGlobalOptions(this);
      const allowed = ["endpoint", "workspace", "token"] as const;
      if (!allowed.includes(key as (typeof allowed)[number])) {
        throw new Error(`Unknown config key: ${key}`);
      }

      const { updateConfig } = await import("../config.js");
      await updateConfig({ [key]: value });
      outputText(`Set ${key}.`, globals);
    });

  configCmd
    .command("get")
    .description("Get config value(s)")
    .argument("[key]", "endpoint | workspace | token")
    .action(async function (this: Command, key?: string) {
      const globals = getGlobalOptions(this);
      const config = await loadConfig();

      if (key) {
        const value = config[key as keyof typeof config] ?? null;
        outputData({ [key]: value }, globals);
        return;
      }

      outputData(config, globals);
    });
}
