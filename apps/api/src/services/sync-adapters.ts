import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  ExternalObject,
  FieldMapping,
  IntegrationProvider,
  NormalizedExternalChange,
} from "@visboard/shared";

export type HeaderBag = Headers | Record<string, string | undefined>;

export interface ProviderWebhookInput {
  headers: HeaderBag;
  rawBody: Uint8Array;
  /** Retrieved from a vault by the caller; never persisted by an adapter. */
  secret?: string;
  receivedAt?: Date;
}

export interface ProviderOutboundMutation {
  provider: IntegrationProvider;
  externalId: string;
  body: Record<string, unknown>;
}

export interface ExternalSyncAdapter {
  readonly provider: IntegrationProvider;
  verifyWebhook(input: ProviderWebhookInput): { valid: boolean; reason?: string };
  normalizeWebhook(input: ProviderWebhookInput): NormalizedExternalChange[];
  toOutboundMutation(
    externalId: string,
    local: Record<string, unknown>,
    mappings: readonly FieldMapping[],
  ): ProviderOutboundMutation;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const name = asString(asRecord(entry).name);
    return name ? [name] : [];
  });
}

function header(input: HeaderBag, name: string): string | undefined {
  if (input instanceof Headers) {
    return input.get(name) ?? undefined;
  }

  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(input)) {
    if (key.toLowerCase() === expected) return value;
  }
  return undefined;
}

function parsePayload(rawBody: Uint8Array): JsonRecord {
  try {
    const decoded = new TextDecoder().decode(rawBody);
    return asRecord(JSON.parse(decoded));
  } catch {
    return {};
  }
}

function rawHash(rawBody: Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

function timestamp(input: ProviderWebhookInput): string {
  return (input.receivedAt ?? new Date()).toISOString();
}

function hmacMatches(
  rawBody: Uint8Array,
  secret: string | undefined,
  received: string | undefined,
  prefix?: string,
): { valid: boolean; reason?: string } {
  if (!secret) {
    return { valid: false, reason: "Webhook secret is not configured" };
  }
  if (!received) {
    return { valid: false, reason: "Missing webhook signature" };
  }

  const candidate =
    prefix && received.startsWith(prefix) ? received.slice(prefix.length) : received;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

  if (candidate.length !== expected.length) {
    return { valid: false, reason: "Webhook signature does not match" };
  }

  try {
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
      ? { valid: true }
      : { valid: false, reason: "Webhook signature does not match" };
  } catch {
    return { valid: false, reason: "Webhook signature is malformed" };
  }
}

function getPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, segment) => {
    if (!isRecord(value)) return undefined;
    return value[segment];
  }, source);
}

function mappedValues(
  local: Record<string, unknown>,
  mappings: readonly FieldMapping[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const mapping of mappings) {
    const value = getPath(local, mapping.local_field);
    if (value !== undefined) result[mapping.external_field] = value;
  }
  return result;
}

function githubExternalId(repository: JsonRecord, issue: JsonRecord): string {
  const nodeId = asString(issue.node_id) ?? asString(issue.id);
  const fullName = asString(repository.full_name);
  const number = issue.number;
  if (fullName && (typeof number === "number" || typeof number === "string")) {
    return `${fullName}#${number}`;
  }
  return nodeId ?? rawHash(new TextEncoder().encode(JSON.stringify(issue)));
}

function titleFromNotionProperties(properties: JsonRecord): string | null {
  for (const value of Object.values(properties)) {
    const property = asRecord(value);
    const title = property.title;
    if (Array.isArray(title)) {
      const rendered = title
        .map((part) => asString(asRecord(part).plain_text) ?? asString(asRecord(part).text))
        .filter((part): part is string => Boolean(part))
        .join("");
      if (rendered) return rendered;
    }
  }
  return null;
}

function bodyFromNotionProperties(properties: JsonRecord): string | null {
  for (const value of Object.values(properties)) {
    const property = asRecord(value);
    const richText = property.rich_text;
    if (Array.isArray(richText)) {
      const rendered = richText
        .map((part) => asString(asRecord(part).plain_text) ?? asString(asRecord(part).text))
        .filter((part): part is string => Boolean(part))
        .join("");
      if (rendered) return rendered;
    }
  }
  return null;
}

class GitHubIssuesAdapter implements ExternalSyncAdapter {
  readonly provider = "github" as const;

  verifyWebhook(input: ProviderWebhookInput) {
    return hmacMatches(
      input.rawBody,
      input.secret,
      header(input.headers, "x-hub-signature-256"),
      "sha256=",
    );
  }

  normalizeWebhook(input: ProviderWebhookInput): NormalizedExternalChange[] {
    const payload = parsePayload(input.rawBody);
    const eventType =
      header(input.headers, "x-github-event") ?? asString(payload.action) ?? "unknown";
    const deliveryId =
      header(input.headers, "x-github-delivery") ??
      asString(payload.delivery_id) ??
      rawHash(input.rawBody);
    const issue = asRecord(payload.issue ?? payload.pull_request);
    const repository = asRecord(payload.repository);
    if (Object.keys(issue).length === 0) return [];

    const isPullRequest = Boolean(payload.pull_request) || Boolean(issue.pull_request);
    const assignee = asString(asRecord(issue.assignee).login);
    const object: ExternalObject = {
      provider: this.provider,
      external_id: githubExternalId(repository, issue),
      kind: isPullRequest ? "pull_request" : "issue",
      title: asString(issue.title),
      body: asString(issue.body),
      state: asString(issue.state),
      url: asString(issue.html_url),
      labels: asStringArray(issue.labels),
      assignee,
      version: asString(issue.updated_at) ?? asString(issue.node_id),
      updated_at: asString(issue.updated_at),
      origin: asString(asRecord(payload.sender).login),
      properties: {
        repository: asString(repository.full_name),
        number: issue.number,
        action: asString(payload.action),
      },
    };

    return [
      {
        provider: this.provider,
        delivery_id: deliveryId,
        event_type: eventType,
        action: asString(payload.action),
        object,
        received_at: timestamp(input),
        raw_hash: rawHash(input.rawBody),
      },
    ];
  }

  toOutboundMutation(
    externalId: string,
    local: Record<string, unknown>,
    mappings: readonly FieldMapping[],
  ) {
    const mapped = mappedValues(local, mappings);
    const body: Record<string, unknown> = {};
    if (mapped.title !== undefined) body.title = mapped.title;
    if (mapped.body !== undefined) body.body = mapped.body;
    if (mapped.state !== undefined) body.state = mapped.state;
    if (mapped.labels !== undefined) body.labels = mapped.labels;
    if (mapped.assignee !== undefined) body.assignees = [mapped.assignee];
    return { provider: this.provider, externalId, body };
  }
}

class NotionAdapter implements ExternalSyncAdapter {
  readonly provider = "notion" as const;

  verifyWebhook(input: ProviderWebhookInput) {
    return hmacMatches(
      input.rawBody,
      input.secret,
      header(input.headers, "x-notion-signature") ??
        header(input.headers, "x-notion-webhook-signature"),
    );
  }

  normalizeWebhook(input: ProviderWebhookInput): NormalizedExternalChange[] {
    const payload = parsePayload(input.rawBody);
    const data = asRecord(payload.data ?? payload.entity ?? payload.page);
    const entity = asRecord(payload.entity);
    const properties = asRecord(data.properties);
    const externalId =
      asString(data.id) ?? asString(entity.id) ?? asString(payload.id) ?? rawHash(input.rawBody);
    const eventType = asString(payload.type) ?? asString(payload.event_type) ?? "page.updated";
    const object: ExternalObject = {
      provider: this.provider,
      external_id: externalId,
      kind: asString(data.object) === "database_item" ? "database_item" : "page",
      title: titleFromNotionProperties(properties) ?? asString(data.title),
      body: bodyFromNotionProperties(properties) ?? asString(data.body),
      state: asString(asRecord(data.status).name) ?? asString(data.state),
      url: asString(data.url),
      labels: [],
      assignee: null,
      version: asString(data.last_edited_time) ?? asString(data.version),
      updated_at: asString(data.last_edited_time),
      origin: asString(payload.workspace_id),
      properties,
    };

    return [
      {
        provider: this.provider,
        delivery_id:
          header(input.headers, "x-notion-delivery-id") ??
          asString(payload.delivery_id) ??
          rawHash(input.rawBody),
        event_type: eventType,
        action: asString(payload.action),
        object,
        received_at: timestamp(input),
        raw_hash: rawHash(input.rawBody),
      },
    ];
  }

  toOutboundMutation(
    externalId: string,
    local: Record<string, unknown>,
    mappings: readonly FieldMapping[],
  ) {
    const mapped = mappedValues(local, mappings);
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mapped)) {
      properties[key] = value;
    }
    return { provider: this.provider, externalId, body: { properties } };
  }
}

class LinearAdapter implements ExternalSyncAdapter {
  readonly provider = "linear" as const;

  verifyWebhook(input: ProviderWebhookInput) {
    return hmacMatches(
      input.rawBody,
      input.secret,
      header(input.headers, "linear-signature") ?? header(input.headers, "x-linear-signature"),
    );
  }

  normalizeWebhook(input: ProviderWebhookInput): NormalizedExternalChange[] {
    const payload = parsePayload(input.rawBody);
    const data = asRecord(payload.data ?? payload.issue);
    if (Object.keys(data).length === 0) return [];
    const state = asRecord(data.state);
    const assignee = asRecord(data.assignee);
    const externalId = asString(data.id) ?? asString(data.identifier) ?? rawHash(input.rawBody);
    const object: ExternalObject = {
      provider: this.provider,
      external_id: externalId,
      kind: "issue",
      title: asString(data.title),
      body: asString(data.description),
      state: asString(state.name) ?? asString(data.status),
      url: asString(data.url),
      labels: asStringArray(data.labels),
      assignee: asString(assignee.id) ?? asString(assignee.name),
      version: asString(data.updatedAt) ?? asString(data.updated_at),
      updated_at: asString(data.updatedAt) ?? asString(data.updated_at),
      origin: asString(payload.organizationId) ?? asString(payload.organization_id),
      properties: {
        identifier: asString(data.identifier),
        team_id: asString(data.teamId) ?? asString(data.team_id),
      },
    };

    return [
      {
        provider: this.provider,
        delivery_id:
          header(input.headers, "linear-delivery") ??
          header(input.headers, "x-linear-delivery") ??
          asString(payload.webhookId) ??
          asString(payload.id) ??
          rawHash(input.rawBody),
        event_type: asString(payload.type) ?? "Issue",
        action: asString(payload.action),
        object,
        received_at: timestamp(input),
        raw_hash: rawHash(input.rawBody),
      },
    ];
  }

  toOutboundMutation(
    externalId: string,
    local: Record<string, unknown>,
    mappings: readonly FieldMapping[],
  ) {
    const mapped = mappedValues(local, mappings);
    const body: Record<string, unknown> = {};
    if (mapped.title !== undefined) body.title = mapped.title;
    if (mapped.description !== undefined) body.description = mapped.description;
    if (mapped.state_id !== undefined) body.stateId = mapped.state_id;
    if (mapped.assignee_id !== undefined) body.assigneeId = mapped.assignee_id;
    if (mapped.label_ids !== undefined) body.labelIds = mapped.label_ids;
    return { provider: this.provider, externalId, body };
  }
}

const adapters: Record<IntegrationProvider, ExternalSyncAdapter> = {
  github: new GitHubIssuesAdapter(),
  notion: new NotionAdapter(),
  linear: new LinearAdapter(),
};

export function getSyncAdapter(provider: IntegrationProvider): ExternalSyncAdapter {
  return adapters[provider];
}

export function listSyncAdapters(): ExternalSyncAdapter[] {
  return Object.values(adapters);
}

export { hmacMatches as verifyWebhookHmac };
