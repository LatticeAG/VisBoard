import { describe, expect, it } from "vitest";
import {
  automationConditionSchema,
  boardInterchangeDocumentSchema,
  fieldMappingSchema,
  semanticEventSchema,
} from "./index.js";

describe("V3 interchange contracts", () => {
  it("requires an explicit source for mirrored sync fields", () => {
    expect(
      fieldMappingSchema.safeParse({
        local_field: "state",
        external_field: "state",
        ownership: "mirrored",
      }).success,
    ).toBe(false);
    expect(
      fieldMappingSchema.safeParse({
        local_field: "state",
        external_field: "state",
        ownership: "mirrored",
        preferred_source: "external",
      }).success,
    ).toBe(true);
  });

  it("keeps automation predicates declarative and semantic events structured", () => {
    expect(
      automationConditionSchema.safeParse({
        path: "payload.to_state",
        operator: "equals",
        value: "done",
      }).success,
    ).toBe(true);
    expect(
      automationConditionSchema.safeParse({
        path: "process.env.SECRET",
        operator: "exists",
      }).success,
    ).toBe(false);
    expect(
      semanticEventSchema.safeParse({
        id: "bev_1",
        type: "kanban.card.transitioned",
        board_id: "brd_1",
        source: "human",
        payload: {},
        created_at: "2026-07-21T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("preserves extension block payloads in the portable JSON envelope", () => {
    const parsed = boardInterchangeDocumentSchema.parse({
      format: "visboard-board-json",
      version: 3,
      exported_at: "2026-07-21T12:00:00.000Z",
      board: { id: "brd_1" },
      blocks: [
        {
          id: "blk_extension",
          type: "acme.widget",
          vendor_payload: { safe_to_round_trip: true },
        },
      ],
      extensions: {},
      lossiness_report: { format: "json", lossless: true, entries: [] },
    });
    expect(parsed.blocks[0]).toMatchObject({
      vendor_payload: { safe_to_round_trip: true },
    });
  });
});
