import { z } from "zod";
import { boardBlockIdSchema } from "./block.js";
import { boardRevisionIdSchema } from "./board.js";
import { timestampSchema } from "./common.js";

export const beliefEntrySchema = z.object({
  id: z.string().min(1).max(128),
  statement: z.string().min(1).max(2000),
  weight: z.number().min(0).max(1).optional(),
  evidence_refs: z.array(z.string().max(256)).max(16).default([]),
  block_ids: z.array(boardBlockIdSchema).max(16).default([]),
  source: z.enum(["agent", "human", "retrieved", "inferred"]).default("agent"),
});

export const beliefTraceSchema = z
  .object({
    schema_version: z.literal(1),
    board_revision_id: boardRevisionIdSchema.nullable(),
    run_id: z.string().min(1).max(128),
    captured_at: timestampSchema,
    summary: z.string().min(1).max(4000),
    beliefs: z.array(beliefEntrySchema).max(32),
    assumptions: z.array(beliefEntrySchema).max(32),
    overweighted: z.array(beliefEntrySchema).max(16),
    ignored: z.array(beliefEntrySchema).max(32),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((val, ctx) => {
    if (Buffer.byteLength(JSON.stringify(val), "utf8") > 64 * 1024) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "belief_trace exceeds 64 KiB" });
    }
  });

export type BeliefEntry = z.infer<typeof beliefEntrySchema>;
export type BeliefTrace = z.infer<typeof beliefTraceSchema>;
