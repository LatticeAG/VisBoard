import type { Command } from "commander";
import { createClient, requireWorkspace } from "../client.js";
import { getGlobalOptions } from "../globals.js";
import { formatTable, outputData, outputText } from "../output.js";

export function registerChecklistCommands(program: Command): void {
  const checklist = program.command("checklist").description("Checklist commands");

  checklist
    .command("list")
    .description("List checklists in a project")
    .requiredOption("--project <slug>", "project slug")
    .action(async function (this: Command, opts: { project: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const checklists = await client.checklists.list(ws, opts.project);

      if (globals.json) {
        outputData(checklists, globals);
        return;
      }

      outputText(
        formatTable(
          checklists.map((c) => ({
            id: c.id,
            title: c.title,
            items: c.items?.length ?? 0,
          })),
          ["id", "title", "items"],
        ),
        globals,
      );
    });

  checklist
    .command("create")
    .description("Create a checklist")
    .requiredOption("--project <slug>", "project slug")
    .requiredOption("--title <title>", "checklist title")
    .action(async function (this: Command, opts: { project: string; title: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const created = await client.checklists.create(ws, opts.project, {
        title: opts.title,
      });
      outputData(created, globals);
    });

  checklist
    .command("add")
    .description("Add an item to a checklist")
    .requiredOption("--project <slug>", "project slug")
    .argument("<chk-id>", "checklist id")
    .requiredOption("--text <text>", "item text")
    .option("--sort-order <n>", "sort order", (v) => Number.parseInt(v, 10))
    .action(async function (
      this: Command,
      chkId: string,
      opts: { project: string; text: string; sortOrder?: number },
    ) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const item = await client.checklists.addItem(ws, opts.project, chkId, {
        text: opts.text,
        sort_order: opts.sortOrder,
      });
      outputData(item, globals);
    });

  checklist
    .command("check")
    .description("Mark a checklist item as done")
    .requiredOption("--project <slug>", "project slug")
    .argument("<chk-id>", "checklist id")
    .argument("<item-id>", "item id")
    .action(async function (
      this: Command,
      chkId: string,
      itemId: string,
      opts: { project: string },
    ) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const item = await client.checklists.updateItem(ws, opts.project, chkId, itemId, {
        done: true,
      });
      outputData(item, globals);
    });

  checklist
    .command("uncheck")
    .description("Mark a checklist item as not done")
    .requiredOption("--project <slug>", "project slug")
    .argument("<chk-id>", "checklist id")
    .argument("<item-id>", "item id")
    .action(async function (
      this: Command,
      chkId: string,
      itemId: string,
      opts: { project: string },
    ) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const item = await client.checklists.updateItem(ws, opts.project, chkId, itemId, {
        done: false,
      });
      outputData(item, globals);
    });
}
