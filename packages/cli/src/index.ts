#!/usr/bin/env node

import { Command } from "commander";
import { registerAgentCommands } from "./commands/agent.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerChecklistCommands } from "./commands/checklist.js";
import { registerContextCommands } from "./commands/context.js";
import { registerFileCommands } from "./commands/file.js";
import { registerNoteCommands } from "./commands/note.js";
import {
  registerConfigCommands,
  registerDoctorCommand,
  registerExportCommand,
  registerImportCommand,
} from "./commands/ops.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerWorkspaceCommands } from "./commands/workspace.js";
import { registerGlobals } from "./globals.js";

const program = new Command();

program
  .name("visboard")
  .description("VisBoard CLI — shared workspace for agents and humans")
  .version("0.1.0");

registerGlobals(program);

registerAuthCommands(program);
registerWorkspaceCommands(program);
registerProjectCommands(program);
registerNoteCommands(program);
registerChecklistCommands(program);
registerFileCommands(program);
registerAgentCommands(program);
registerContextCommands(program);
registerExportCommand(program);
registerImportCommand(program);
registerDoctorCommand(program);
registerConfigCommands(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
