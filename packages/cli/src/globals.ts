import type { Command } from "commander";
import type { GlobalOptions } from "./output.js";

export function getGlobalOptions(command: Command): GlobalOptions {
  const opts = command.optsWithGlobals() as GlobalOptions;
  return {
    json: opts.json,
    quiet: opts.quiet,
    endpoint: opts.endpoint,
    workspace: opts.workspace,
  };
}

export function registerGlobals(program: Command): void {
  program
    .option("--json", "machine-readable output")
    .option("--quiet", "errors only")
    .option("--endpoint <url>", "override API endpoint")
    .option("--workspace <slug>", "override workspace slug");
}
