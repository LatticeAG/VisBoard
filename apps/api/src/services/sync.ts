import {
  type Database,
  integrationConnections,
  syncConflicts as syncConflictsTable,
  syncLinks as syncLinksTable,
} from "@visboard/db";
import { createId } from "@visboard/shared";
import type {
  CreateIntegrationConnection,
  CreateSyncLink,
  ExternalObject,
  FieldMapping,
  IntegrationConnection,
  NormalizedExternalChange,
  SyncConflict,
  SyncLink,
} from "@visboard/shared";
import { integrationConnectionSchema, syncLinkSchema } from "@visboard/shared";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../lib/secrets.js";
import { type HeaderBag, type ProviderOutboundMutation, getSyncAdapter } from "./sync-adapters.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function deeplyEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, source);
}

function setPath(target: JsonRecord, path: string, value: unknown): void {
  const parts = path.split(".");
  const last = parts.pop();
  if (!last) return;
  let cursor = target;
  for (const part of parts) {
    const existing = cursor[part];
    if (!isRecord(existing)) {
      const next: JsonRecord = {};
      cursor[part] = next;
      cursor = next;
    } else {
      cursor = existing;
    }
  }
  cursor[last] = value;
}

function baselineValue(baseline: JsonRecord, mapping: FieldMapping): unknown {
  const nested = getPath(baseline, mapping.local_field);
  if (nested !== undefined) return nested;
  return baseline[mapping.local_field];
}

function externalValue(object: ExternalObject, mapping: FieldMapping): unknown {
  const direct = getPath(object, mapping.external_field);
  if (direct !== undefined) return direct;
  return getPath(object.properties, mapping.external_field);
}

export interface MergeConflictCandidate {
  field: string;
  baseline: unknown;
  local: unknown;
  remote: unknown;
}

export interface ThreeWayMergeResult {
  patch: JsonRecord;
  nextBaseline: JsonRecord;
  conflicts: MergeConflictCandidate[];
  ignoredFields: string[];
}

/**
 * A deterministic, field-owned merge. The caller applies only `patch`; a
 * conflict leaves the authoritative local state untouched and pauses the link.
 */
export function mergeExternalChange(
  link: Pick<SyncLink, "baseline" | "field_mappings">,
  local: JsonRecord,
  remote: ExternalObject,
): ThreeWayMergeResult {
  const patch: JsonRecord = {};
  const nextBaseline = clone(link.baseline);
  const conflicts: MergeConflictCandidate[] = [];
  const ignoredFields: string[] = [];

  for (const mapping of link.field_mappings) {
    const baseline = baselineValue(link.baseline, mapping);
    const localValue = getPath(local, mapping.local_field);
    const remoteValue = externalValue(remote, mapping);
    const localChanged = !deeplyEqual(localValue, baseline);
    const remoteChanged = !deeplyEqual(remoteValue, baseline);

    if (!remoteChanged) continue;

    if (mapping.ownership === "external") {
      setPath(patch, mapping.local_field, remoteValue);
      setPath(nextBaseline, mapping.local_field, remoteValue);
      continue;
    }

    if (mapping.ownership === "visboard") {
      ignoredFields.push(mapping.local_field);
      continue;
    }

    if (mapping.ownership === "shared") {
      if (!localChanged || deeplyEqual(localValue, remoteValue)) {
        setPath(patch, mapping.local_field, remoteValue);
        setPath(nextBaseline, mapping.local_field, remoteValue);
      } else {
        conflicts.push({
          field: mapping.local_field,
          baseline,
          local: localValue,
          remote: remoteValue,
        });
      }
      continue;
    }

    // Mirrored values have an explicit preferred source but still surface a
    // simultaneous incompatible change rather than silently overwriting it.
    if (localChanged && !deeplyEqual(localValue, remoteValue)) {
      conflicts.push({
        field: mapping.local_field,
        baseline,
        local: localValue,
        remote: remoteValue,
      });
      continue;
    }

    if (mapping.preferred_source !== "visboard") {
      setPath(patch, mapping.local_field, remoteValue);
      setPath(nextBaseline, mapping.local_field, remoteValue);
    } else {
      ignoredFields.push(mapping.local_field);
    }
  }

  return { patch, nextBaseline, conflicts, ignoredFields };
}

export interface SyncResourceGateway {
  /** Reads the latest local projection for one linked resource. */
  readLocal(link: SyncLink): Promise<JsonRecord>;
  /** Applies only validated external fields through the board command boundary. */
  applyInbound(link: SyncLink, patch: JsonRecord, change: NormalizedExternalChange): Promise<void>;
  /** Optional hook for durable semantic events/audit/outbox integration. */
  onApplied?(link: SyncLink, change: NormalizedExternalChange, patch: JsonRecord): Promise<void>;
  onConflict?(link: SyncLink, conflict: SyncConflict): Promise<void>;
  /** Current board effect fence, checked immediately before an outbound effect. */
  getEffectGeneration?(boardId: string): Promise<number | undefined>;
}

export interface SyncEngineOptions {
  gateway: SyncResourceGateway;
  resolveSecret?: (connection: IntegrationConnection) => Promise<string | undefined>;
  now?: () => Date;
  db?: Database["db"];
  secretsKey?: Buffer;
}

export interface WebhookIngestResult {
  accepted: boolean;
  duplicate: boolean;
  applied: number;
  conflicts: SyncConflict[];
  ignored: number;
  reason?: string;
}

export interface OutboundDelivery {
  mutation: ProviderOutboundMutation;
  idempotencyKey: string;
  link: SyncLink;
}

export interface OutboundDeliveryResult {
  remoteVersion?: string | null;
  baseline?: JsonRecord;
}

export type OutboundExecutor = (delivery: OutboundDelivery) => Promise<OutboundDeliveryResult>;

/**
 * A small in-process reference store. Production can replace it with tables
 * and a job worker without changing adapter or merge semantics; the engine
 * has no dependency on board table names.
 */
export class SyncEngine {
  private readonly connections = new Map<string, IntegrationConnection>();
  private readonly links = new Map<string, SyncLink>();
  private readonly conflicts = new Map<string, SyncConflict>();
  private readonly inbox = new Set<string>();
  private readonly outboundDeliveries = new Set<string>();
  private readonly linkTails = new Map<string, Promise<void>>();
  private readonly secrets = new Map<string, string>();
  private readonly now: () => Date;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: SyncEngineOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async flush(): Promise<void> {
    await this.persistChain;
  }

  createConnection(input: CreateIntegrationConnection, secret?: string): IntegrationConnection {
    const now = this.now().toISOString();
    const connection = integrationConnectionSchema.parse({
      ...input,
      id: input.id ?? createId("icon"),
      created_at: now,
      updated_at: now,
    });
    this.connections.set(connection.id, connection);
    if (secret) this.secrets.set(connection.id, secret);
    this.enqueuePersist(() => this.saveConnection(connection));
    return clone(connection);
  }

  getConnection(id: string): IntegrationConnection | null {
    const connection = this.connections.get(id);
    return connection ? clone(connection) : null;
  }

  listConnections(): IntegrationConnection[] {
    return [...this.connections.values()].map(clone);
  }

  setConnectionStatus(
    id: string,
    status: IntegrationConnection["status"],
  ): IntegrationConnection | null {
    const current = this.connections.get(id);
    if (!current) return null;
    const updated = { ...current, status, updated_at: this.now().toISOString() };
    this.connections.set(id, updated);
    this.enqueuePersist(() => this.saveConnection(updated));
    return clone(updated);
  }

  createLink(input: CreateSyncLink): SyncLink {
    const connection = this.connections.get(input.connection_id);
    if (!connection) throw new Error(`Integration connection '${input.connection_id}' not found`);
    const now = this.now().toISOString();
    const link = syncLinkSchema.parse({
      ...input,
      id: input.id ?? createId("slink"),
      version: 0,
      created_at: now,
      updated_at: now,
    });
    this.links.set(link.id, link);
    this.enqueuePersist(() => this.saveLink(link));
    return clone(link);
  }

  getLink(id: string): SyncLink | null {
    const link = this.links.get(id);
    return link ? clone(link) : null;
  }

  listLinks(boardId?: string): SyncLink[] {
    return [...this.links.values()]
      .filter((link) => !boardId || link.board_id === boardId)
      .map(clone);
  }

  listConflicts(linkId?: string): SyncConflict[] {
    return [...this.conflicts.values()]
      .filter((conflict) => !linkId || conflict.link_id === linkId)
      .map(clone);
  }

  /**
   * Marks an explicitly resolved conflict and advances the three-way baseline
   * to the value selected by the resolver (local by default). Applying a
   * remote choice itself remains a board command owned by the injected gateway.
   */
  resolveConflict(id: string, resolvedValue?: unknown): SyncConflict | null {
    const conflict = this.conflicts.get(id);
    if (!conflict || conflict.state !== "open") return conflict ? clone(conflict) : null;
    const updated: SyncConflict = {
      ...conflict,
      state: "resolved",
      resolved_at: this.now().toISOString(),
    };
    this.conflicts.set(id, updated);
    const link = this.links.get(conflict.link_id);
    if (link) {
      const baseline = clone(link.baseline);
      setPath(baseline, conflict.field, resolvedValue ?? conflict.local);
      const hasOpenConflicts = [...this.conflicts.values()].some(
        (candidate) => candidate.link_id === link.id && candidate.state === "open",
      );
      this.links.set(link.id, {
        ...link,
        baseline,
        state: hasOpenConflicts ? "conflicted" : "active",
        version: link.version + 1,
        updated_at: this.now().toISOString(),
      });
      const next = this.links.get(link.id);
      if (next) this.enqueuePersist(() => this.saveLink(next));
    }
    this.enqueuePersist(() => this.saveConflict(updated));
    return clone(updated);
  }

  async ingestWebhook(
    connectionId: string,
    headers: HeaderBag,
    rawBody: Uint8Array,
  ): Promise<WebhookIngestResult> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return {
        accepted: false,
        duplicate: false,
        applied: 0,
        conflicts: [],
        ignored: 0,
        reason: "Connection not found",
      };
    }
    if (connection.status !== "active") {
      return {
        accepted: false,
        duplicate: false,
        applied: 0,
        conflicts: [],
        ignored: 0,
        reason: "Connection is not active",
      };
    }

    const adapter = getSyncAdapter(connection.provider);
    const secret = await this.resolveConnectionSecret(connection);
    const input = { headers, rawBody, secret, receivedAt: this.now() };
    const verification = adapter.verifyWebhook(input);
    if (!verification.valid) {
      return {
        accepted: false,
        duplicate: false,
        applied: 0,
        conflicts: [],
        ignored: 0,
        reason: verification.reason,
      };
    }

    const changes = adapter.normalizeWebhook(input);
    let duplicate = false;
    let applied = 0;
    let ignored = 0;
    const conflicts: SyncConflict[] = [];

    for (const change of changes) {
      const inboxKey = `${connectionId}:${change.delivery_id}`;
      if (this.inbox.has(inboxKey)) {
        duplicate = true;
        continue;
      }
      this.inbox.add(inboxKey);
      try {
        const matching = [...this.links.values()].filter(
          (link) =>
            link.connection_id === connectionId &&
            link.external_id === change.object.external_id &&
            link.state === "active" &&
            (link.direction === "inbound" || link.direction === "bidirectional"),
        );

        if (matching.length === 0) {
          ignored += 1;
          continue;
        }

        for (const link of matching) {
          const result = await this.withLinkLock(link.id, async () =>
            this.applyInboundChange(link.id, change),
          );
          applied += result.applied;
          ignored += result.ignored;
          conflicts.push(...result.conflicts);
        }
      } catch (error) {
        // Do not permanently deduplicate a delivery that failed before a
        // durable application. A worker can retry it with the same delivery id.
        this.inbox.delete(inboxKey);
        throw error;
      }
    }

    return { accepted: true, duplicate, applied, conflicts, ignored };
  }

  async deliverOutbound(
    linkId: string,
    local: JsonRecord,
    executor: OutboundExecutor,
    expectedEffectGeneration?: number,
  ): Promise<{ delivered: boolean; duplicate: boolean; reason?: string }> {
    return this.withLinkLock(linkId, async () => {
      const link = this.links.get(linkId);
      if (!link) return { delivered: false, duplicate: false, reason: "Sync link not found" };
      if (link.state !== "active")
        return { delivered: false, duplicate: false, reason: "Sync link is not active" };
      if (link.direction !== "outbound" && link.direction !== "bidirectional") {
        return {
          delivered: false,
          duplicate: false,
          reason: "Sync link does not allow outbound updates",
        };
      }
      const connection = this.connections.get(link.connection_id);
      if (!connection || connection.status !== "active") {
        return { delivered: false, duplicate: false, reason: "Connection is not active" };
      }

      const effectGeneration = await this.options.gateway.getEffectGeneration?.(link.board_id);
      if (
        expectedEffectGeneration !== undefined &&
        effectGeneration !== undefined &&
        expectedEffectGeneration !== effectGeneration
      ) {
        return {
          delivered: false,
          duplicate: false,
          reason: "Board effect generation has changed",
        };
      }

      const idempotencyKey = `${link.id}:${link.version}:${stableStringify(local)}`;
      if (this.outboundDeliveries.has(idempotencyKey)) {
        return { delivered: true, duplicate: true };
      }

      const mutation = getSyncAdapter(connection.provider).toOutboundMutation(
        link.external_id,
        local,
        link.field_mappings,
      );
      const result = await executor({ mutation, idempotencyKey, link: clone(link) });

      // Recheck the fence immediately before recording a successful effect.
      const currentGeneration = await this.options.gateway.getEffectGeneration?.(link.board_id);
      if (
        expectedEffectGeneration !== undefined &&
        currentGeneration !== undefined &&
        currentGeneration !== expectedEffectGeneration
      ) {
        return {
          delivered: false,
          duplicate: false,
          reason: "Board effect generation changed during delivery",
        };
      }

      this.outboundDeliveries.add(idempotencyKey);
      const updated: SyncLink = {
        ...link,
        baseline: result.baseline ? clone(result.baseline) : clone(local),
        remote_version: result.remoteVersion ?? link.remote_version ?? null,
        version: link.version + 1,
        updated_at: this.now().toISOString(),
      };
      this.links.set(link.id, updated);
      this.enqueuePersist(() => this.saveLink(updated));
      return { delivered: true, duplicate: false };
    });
  }

  private async applyInboundChange(
    linkId: string,
    change: NormalizedExternalChange,
  ): Promise<{ applied: number; ignored: number; conflicts: SyncConflict[] }> {
    const link = this.links.get(linkId);
    if (!link || link.state !== "active") return { applied: 0, ignored: 1, conflicts: [] };

    // Provider adapters can preserve this marker on remote objects. If they do,
    // a delivery caused by this exact link is not echoed back into VisBoard.
    const origin = change.object.origin;
    const marker = getPath(change.object.properties, "visboard_sync_link_id");
    if (origin === `visboard:${link.id}` || marker === link.id) {
      return { applied: 0, ignored: 1, conflicts: [] };
    }

    const local = await this.options.gateway.readLocal(clone(link));
    const merge = mergeExternalChange(link, local, change.object);
    if (merge.conflicts.length > 0) {
      const created = merge.conflicts.map((candidate) => {
        const conflict: SyncConflict = {
          id: createId("scfl"),
          link_id: link.id,
          field: candidate.field,
          baseline: candidate.baseline,
          local: candidate.local,
          remote: candidate.remote,
          state: "open",
          created_at: this.now().toISOString(),
          resolved_at: null,
        };
        this.conflicts.set(conflict.id, conflict);
        this.enqueuePersist(() => this.saveConflict(conflict));
        return conflict;
      });
      const conflicted: SyncLink = {
        ...link,
        state: "conflicted",
        updated_at: this.now().toISOString(),
      };
      this.links.set(link.id, conflicted);
      this.enqueuePersist(() => this.saveLink(conflicted));
      for (const conflict of created) {
        await this.options.gateway.onConflict?.(clone(conflicted), clone(conflict));
      }
      return { applied: 0, ignored: merge.ignoredFields.length, conflicts: created };
    }

    if (Object.keys(merge.patch).length > 0) {
      await this.options.gateway.applyInbound(clone(link), merge.patch, change);
      await this.options.gateway.onApplied?.(clone(link), change, merge.patch);
    }

    const updated: SyncLink = {
      ...link,
      baseline: merge.nextBaseline,
      remote_version: change.object.version ?? link.remote_version ?? null,
      version: link.version + 1,
      updated_at: this.now().toISOString(),
    };
    this.links.set(link.id, updated);
    this.enqueuePersist(() => this.saveLink(updated));
    return {
      applied: Object.keys(merge.patch).length > 0 ? 1 : 0,
      ignored: merge.ignoredFields.length,
      conflicts: [],
    };
  }

  private async withLinkLock<T>(linkId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.linkTails.get(linkId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.linkTails.set(linkId, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (this.linkTails.get(linkId) === tail) {
        this.linkTails.delete(linkId);
      }
    }
  }

  async hydrate(): Promise<void> {
    const db = this.options.db;
    if (!db) return;
    const connectionRows = await db.select().from(integrationConnections);
    for (const row of connectionRows) {
      const definition = isRecord(row.definition) ? row.definition : {};
      const parsed = integrationConnectionSchema.safeParse({
        ...definition,
        id: row.id,
        provider: row.provider,
        workspace_id: row.workspaceId,
        status: row.status,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
      });
      if (parsed.success) this.connections.set(parsed.data.id, parsed.data);
    }
    const linkRows = await db.select().from(syncLinksTable);
    for (const row of linkRows) {
      const details = isRecord(row.details) ? row.details : {};
      const fieldMap = Array.isArray(row.fieldMap)
        ? row.fieldMap
        : isRecord(row.fieldMap) && Array.isArray(row.fieldMap.field_mappings)
          ? row.fieldMap.field_mappings
          : details.field_mappings;
      const parsed = syncLinkSchema.safeParse({
        id: row.id,
        connection_id: row.connectionId,
        board_id: row.boardId,
        resource_id: row.localResourceId,
        external_id: row.externalId,
        external_kind: details.external_kind,
        direction: row.direction,
        field_mappings: fieldMap,
        baseline: details.baseline ?? {},
        remote_version: details.remote_version ?? null,
        state: row.state,
        version: row.lockVersion,
        created_at: typeof details.created_at === "string" ? details.created_at : undefined,
        updated_at: typeof details.updated_at === "string" ? details.updated_at : undefined,
      });
      if (parsed.success) this.links.set(parsed.data.id, parsed.data);
    }
    const conflictRows = await db.select().from(syncConflictsTable);
    for (const row of conflictRows) {
      const payload = isRecord(row.payload) ? row.payload : {};
      this.conflicts.set(row.id, {
        id: row.id,
        link_id: row.linkId,
        field: typeof payload.field === "string" ? payload.field : "",
        baseline: payload.baseline,
        local: payload.local,
        remote: payload.remote,
        state: row.state as SyncConflict["state"],
        created_at: row.createdAt.toISOString(),
        resolved_at: typeof payload.resolved_at === "string" ? payload.resolved_at : null,
      });
    }
  }

  private enqueuePersist(work: () => Promise<void>): void {
    if (!this.options.db) return;
    this.persistChain = this.persistChain.then(work).catch((err) => {
      console.error("sync persist failed", err);
    });
  }

  private async resolveConnectionSecret(
    connection: IntegrationConnection,
  ): Promise<string | undefined> {
    if (this.options.resolveSecret) {
      const fromOpt = await this.options.resolveSecret(connection);
      if (fromOpt) return fromOpt;
    }
    const cached = this.secrets.get(connection.id);
    if (cached) return cached;
    const db = this.options.db;
    const key = this.options.secretsKey;
    if (!db || !key) return undefined;
    const [row] = await db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connection.id))
      .limit(1);
    if (!row?.secretCiphertext || !row.secretIv || !row.secretTag) return undefined;
    return decryptSecret(
      { ciphertext: row.secretCiphertext, iv: row.secretIv, tag: row.secretTag },
      key,
    );
  }

  private async saveConnection(connection: IntegrationConnection): Promise<void> {
    const db = this.options.db;
    if (!db) return;
    const secret = this.secrets.get(connection.id);
    const definition: JsonRecord = {
      display_name: connection.display_name,
      organization_id: connection.organization_id ?? null,
      capabilities: connection.capabilities,
      secret_reference: connection.secret_reference ?? null,
    };
    const encrypted =
      secret && this.options.secretsKey ? encryptSecret(secret, this.options.secretsKey) : null;
    await db
      .insert(integrationConnections)
      .values({
        id: connection.id,
        workspaceId: connection.workspace_id ?? "",
        provider: connection.provider,
        status: connection.status,
        secretCiphertext: encrypted?.ciphertext ?? "",
        secretIv: encrypted?.iv ?? "",
        secretTag: encrypted?.tag ?? "",
        definition,
        createdAt: new Date(connection.created_at ?? Date.now()),
        updatedAt: new Date(connection.updated_at ?? Date.now()),
      })
      .onConflictDoUpdate({
        target: integrationConnections.id,
        set: {
          status: connection.status,
          definition,
          updatedAt: new Date(connection.updated_at ?? Date.now()),
          ...(encrypted
            ? {
                secretCiphertext: encrypted.ciphertext,
                secretIv: encrypted.iv,
                secretTag: encrypted.tag,
              }
            : {}),
        },
      });
  }

  private async saveLink(link: SyncLink): Promise<void> {
    const db = this.options.db;
    if (!db) return;
    const fieldMap = { field_mappings: link.field_mappings } as JsonRecord;
    const details: JsonRecord = {
      baseline: link.baseline,
      field_mappings: link.field_mappings,
      remote_version: link.remote_version ?? null,
      external_kind: link.external_kind,
      created_at: link.created_at,
      updated_at: link.updated_at,
    };
    await db
      .insert(syncLinksTable)
      .values({
        id: link.id,
        connectionId: link.connection_id,
        boardId: link.board_id,
        localResourceId: link.resource_id,
        externalId: link.external_id,
        direction: link.direction,
        fieldMap,
        state: link.state,
        lockVersion: link.version,
        details,
      })
      .onConflictDoUpdate({
        target: syncLinksTable.id,
        set: {
          localResourceId: link.resource_id,
          externalId: link.external_id,
          direction: link.direction,
          fieldMap,
          state: link.state,
          lockVersion: link.version,
          details,
        },
      });
  }

  private async saveConflict(conflict: SyncConflict): Promise<void> {
    const db = this.options.db;
    if (!db) return;
    const payload: JsonRecord = {
      field: conflict.field,
      baseline: conflict.baseline as unknown,
      local: conflict.local as unknown,
      remote: conflict.remote as unknown,
      resolved_at: conflict.resolved_at ?? null,
    };
    await db
      .insert(syncConflictsTable)
      .values({
        id: conflict.id,
        linkId: conflict.link_id,
        payload,
        state: conflict.state,
        createdAt: new Date(conflict.created_at),
      })
      .onConflictDoUpdate({
        target: syncConflictsTable.id,
        set: { payload, state: conflict.state },
      });
  }
}
