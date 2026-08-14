import { z } from "zod";

export const boardExportFormatSchema = z.enum(["json", "markdown"]);

export const lossinessEntrySchema = z.object({
  code: z.string().min(1),
  path: z.string().min(1),
  message: z.string().min(1),
});

export const lossinessReportSchema = z.object({
  format: boardExportFormatSchema,
  lossless: z.boolean(),
  entries: z.array(lossinessEntrySchema).default([]),
});

/**
 * A deliberately permissive block envelope. The core block registry owns
 * block-specific fields; interchange must preserve unknown blocks rather than
 * discard them during a portability round trip.
 */
export const interchangeBlockSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    schema_version: z.number().int().positive().optional(),
    parent_id: z.string().nullable().optional(),
    attributes: z.record(z.unknown()).optional(),
    content: z.record(z.unknown()).optional(),
    relations: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export const boardInterchangeDocumentSchema = z.object({
  format: z.literal("visboard-board-json"),
  version: z.literal(3),
  exported_at: z.string(),
  board: z.record(z.unknown()),
  document: z.record(z.unknown()).nullable().optional(),
  revision: z.record(z.unknown()).nullable().optional(),
  blocks: z.array(interchangeBlockSchema),
  /** Optional portable metadata such as template/sync-link provenance. */
  extensions: z.record(z.unknown()).default({}),
  lossiness_report: lossinessReportSchema,
});

export const markdownImportDocumentSchema = z.object({
  format: z.literal("visboard-board-markdown"),
  version: z.literal(3),
  board: z.record(z.unknown()),
  blocks: z.array(interchangeBlockSchema),
  extensions: z.record(z.unknown()).default({}),
  lossiness_report: lossinessReportSchema,
});

export type BoardExportFormat = z.infer<typeof boardExportFormatSchema>;
export type LossinessEntry = z.infer<typeof lossinessEntrySchema>;
export type LossinessReport = z.infer<typeof lossinessReportSchema>;
export type InterchangeBlock = z.infer<typeof interchangeBlockSchema>;
export type BoardInterchangeDocument = z.infer<typeof boardInterchangeDocumentSchema>;
export type MarkdownImportDocument = z.infer<typeof markdownImportDocumentSchema>;
