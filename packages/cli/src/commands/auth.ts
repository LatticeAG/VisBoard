import type { Command } from "commander";
import { createClient } from "../client.js";
import { loadConfig, saveConfig, updateConfig } from "../config.js";
import { getGlobalOptions } from "../globals.js";
import { outputData, outputText } from "../output.js";

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Authentication commands");

  auth
    .command("bootstrap")
    .description("Bootstrap a new VisBoard instance")
    .requiredOption("--name <name>", "workspace name")
    .option("--slug <slug>", "workspace slug")
    .option("--bootstrap-token <token>", "bootstrap token for gated instances")
    .action(async function (
      this: Command,
      opts: { name: string; slug?: string; bootstrapToken?: string },
    ) {
      const globals = getGlobalOptions(this);
      const { client } = await createClient(globals);
      const result = await client.bootstrap.create({
        name: opts.name,
        slug: opts.slug,
        bootstrapToken: opts.bootstrapToken,
      });

      await updateConfig({
        endpoint: globals.endpoint ?? (await loadConfig()).endpoint,
        token: result.token,
        workspace: result.workspace.slug,
      });

      if (globals.json) {
        outputData(result, globals);
      } else {
        outputText(`Bootstrap complete. Workspace: ${result.workspace.slug}`, globals);
        outputText(`Token (save now; shown once): ${result.token}`, globals);
      }
    });

  auth
    .command("set-token")
    .description("Save a personal access token")
    .argument("<token>", "PAT token")
    .action(async function (this: Command, token: string) {
      const globals = getGlobalOptions(this);
      await updateConfig({ token });
      outputText("Token saved.", globals);
    });

  auth
    .command("status")
    .description("Show auth configuration status")
    .action(async function (this: Command) {
      const globals = getGlobalOptions(this);
      const config = await loadConfig();
      const status = {
        endpoint: globals.endpoint ?? config.endpoint ?? "http://localhost:8080/v1",
        workspace: globals.workspace ?? config.workspace ?? null,
        has_token: Boolean(config.token),
        token_prefix: config.token ? `${config.token.slice(0, 12)}...` : null,
      };
      outputData(status, globals);
    });

  auth
    .command("logout")
    .description("Remove stored token")
    .action(async function (this: Command) {
      const globals = getGlobalOptions(this);
      const config = await loadConfig();
      config.token = undefined;
      await saveConfig(config);
      outputText("Token removed.", globals);
    });
}
