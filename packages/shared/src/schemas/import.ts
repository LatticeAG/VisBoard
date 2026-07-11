import { z } from "zod";

export const importResultSchema = z.object({
  projects_imported: z.number().int().nonnegative(),
  notes_imported: z.number().int().nonnegative(),
  checklists_imported: z.number().int().nonnegative(),
  files_imported: z.number().int().nonnegative(),
});

export type ImportResult = z.infer<typeof importResultSchema>;
