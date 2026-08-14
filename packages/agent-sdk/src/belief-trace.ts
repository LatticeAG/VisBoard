import { beliefTraceSchema } from "@visboard/shared";
import { HandoffStateError } from "./errors.js";
import { checksum } from "./serialize.js";
import type { BeliefTrace } from "./types.js";

export function requireBeliefTraceForSubmit(packet: { belief_trace?: BeliefTrace }): BeliefTrace {
  if (!packet.belief_trace) {
    throw new HandoffStateError(
      "belief_trace is required to submit a handoff",
      "handoff.belief_trace_required",
    );
  }
  const parsed = beliefTraceSchema.safeParse(packet.belief_trace);
  if (!parsed.success) {
    throw new HandoffStateError(
      parsed.error.issues[0]?.message ?? "belief_trace is invalid",
      "handoff.belief_trace_invalid",
    );
  }
  return parsed.data;
}

export function hashBeliefTrace(trace: BeliefTrace): string {
  return checksum(trace);
}
