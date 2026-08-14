import { ulid } from "ulid";

export const PREFIX = {
  workspace: "ws",
  project: "prj",
  board: "brd",
  boardDocument: "bdoc",
  boardBlock: "blk",
  boardRevision: "rev",
  boardEvent: "bev",
  template: "tpl",
  templateVersion: "tplv",
  templateInstallation: "tpli",
  templateBlockMapping: "tplm",
  note: "nt",
  noteVersion: "ntv",
  checklist: "chk",
  item: "item",
  file: "file",
  agent: "agent",
  event: "evt",
  user: "user",
  pat: "pat",
  agentWorkspace: "aws",
  agentWorkspaceFile: "awf",
  agentRun: "arun",
  agentLease: "lease",
  handoff: "hof",
  handoffDecision: "hdec",
  automationRule: "arule",
  automationRunJob: "arunjob",
  automationActionRun: "aact",
  integrationConnection: "icon",
  syncLink: "slink",
  syncConflict: "scfl",
  exportJob: "exp",
  idempotencyRecord: "idem",
} as const;

export type PrefixKey = keyof typeof PREFIX;

export function createId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

export function createPrefixedId(key: PrefixKey): string {
  return createId(PREFIX[key]);
}

const ULID_PATTERN = "[0-9A-HJKMNP-TV-Z]{26}";

export const ID_PATTERNS = {
  workspace: new RegExp(`^ws_${ULID_PATTERN}$`),
  project: new RegExp(`^prj_${ULID_PATTERN}$`),
  board: new RegExp(`^brd_${ULID_PATTERN}$`),
  boardDocument: new RegExp(`^bdoc_${ULID_PATTERN}$`),
  boardBlock: new RegExp(`^blk_${ULID_PATTERN}$`),
  boardRevision: new RegExp(`^rev_${ULID_PATTERN}$`),
  boardEvent: new RegExp(`^bev_${ULID_PATTERN}$`),
  template: new RegExp(`^tpl_${ULID_PATTERN}$`),
  templateVersion: new RegExp(`^tplv_${ULID_PATTERN}$`),
  templateInstallation: new RegExp(`^tpli_${ULID_PATTERN}$`),
  templateBlockMapping: new RegExp(`^tplm_${ULID_PATTERN}$`),
  note: new RegExp(`^nt_${ULID_PATTERN}$`),
  noteVersion: new RegExp(`^ntv_${ULID_PATTERN}$`),
  checklist: new RegExp(`^chk_${ULID_PATTERN}$`),
  item: new RegExp(`^item_${ULID_PATTERN}$`),
  file: new RegExp(`^file_${ULID_PATTERN}$`),
  agent: new RegExp(`^agent_${ULID_PATTERN}$`),
  event: new RegExp(`^evt_${ULID_PATTERN}$`),
  user: new RegExp(`^user_${ULID_PATTERN}$`),
  pat: new RegExp(`^pat_${ULID_PATTERN}$`),
  agentWorkspace: new RegExp(`^aws_${ULID_PATTERN}$`),
  agentWorkspaceFile: new RegExp(`^awf_${ULID_PATTERN}$`),
  agentRun: new RegExp(`^arun_${ULID_PATTERN}$`),
  agentLease: new RegExp(`^lease_${ULID_PATTERN}$`),
  handoff: new RegExp(`^hof_${ULID_PATTERN}$`),
  handoffDecision: new RegExp(`^hdec_${ULID_PATTERN}$`),
  automationRule: new RegExp(`^arule_${ULID_PATTERN}$`),
  automationRunJob: new RegExp(`^arunjob_${ULID_PATTERN}$`),
  automationActionRun: new RegExp(`^aact_${ULID_PATTERN}$`),
  integrationConnection: new RegExp(`^icon_${ULID_PATTERN}$`),
  syncLink: new RegExp(`^slink_${ULID_PATTERN}$`),
  syncConflict: new RegExp(`^scfl_${ULID_PATTERN}$`),
  exportJob: new RegExp(`^exp_${ULID_PATTERN}$`),
  idempotencyRecord: new RegExp(`^idem_${ULID_PATTERN}$`),
} as const;

export function isValidId(value: string, kind: keyof typeof ID_PATTERNS): boolean {
  return ID_PATTERNS[kind].test(value);
}

export function parseIdPrefix(value: string): string | null {
  const idx = value.indexOf("_");
  if (idx === -1) return null;
  return value.slice(0, idx);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
