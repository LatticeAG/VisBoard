import type { Database } from "@visboard/db";

const DRIZZLE_NAME = Symbol.for("drizzle:Name");

export type InMemoryStore = {
  workspaces: Array<Record<string, unknown>>;
  users: Array<Record<string, unknown>>;
  workspace_members: Array<Record<string, unknown>>;
  personal_access_tokens: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  project_members: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  note_versions: Array<Record<string, unknown>>;
  checklists: Array<Record<string, unknown>>;
  checklist_items: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  boards: Array<Record<string, unknown>>;
  board_documents: Array<Record<string, unknown>>;
  board_blocks: Array<Record<string, unknown>>;
  board_revisions: Array<Record<string, unknown>>;
  board_events: Array<Record<string, unknown>>;
  board_templates: Array<Record<string, unknown>>;
  template_versions: Array<Record<string, unknown>>;
  template_installations: Array<Record<string, unknown>>;
  template_block_mappings: Array<Record<string, unknown>>;
};

export function createEmptyStore(): InMemoryStore {
  return {
    workspaces: [],
    users: [],
    workspace_members: [],
    personal_access_tokens: [],
    projects: [],
    project_members: [],
    notes: [],
    note_versions: [],
    checklists: [],
    checklist_items: [],
    files: [],
    agents: [],
    events: [],
    boards: [],
    board_documents: [],
    board_blocks: [],
    board_revisions: [],
    board_events: [],
    board_templates: [],
    template_versions: [],
    template_installations: [],
    template_block_mappings: [],
  };
}

function tableKey(table: object): keyof InMemoryStore {
  const name = (table as Record<symbol, string>)[DRIZZLE_NAME];
  if (!name || !(name in createEmptyStore())) {
    throw new Error(`Unknown table: ${String(name)}`);
  }
  return name as keyof InMemoryStore;
}

function isCountSelect(arg: unknown): boolean {
  return (
    typeof arg === "object" &&
    arg !== null &&
    "value" in arg &&
    Object.keys(arg as object).length <= 2
  );
}

export function createInMemoryDb(
  initial?: Partial<InMemoryStore>,
): Database & { store: InMemoryStore; getUpdateCallCount: () => number } {
  const store: InMemoryStore = { ...createEmptyStore(), ...initial };
  let updateCallCount = 0;

  const db = {
    select: (arg?: unknown) => {
      if (isCountSelect(arg)) {
        return {
          from: (table: object) => ({
            // biome-ignore lint/suspicious/noThenProperty: mock-db.ts promise-like drizzle count chain
            then: (resolve: (rows: { value: number }[]) => void) => {
              const key = tableKey(table);
              resolve([{ value: store[key].length }]);
            },
          }),
        };
      }

      return {
        from: (table: object) => {
          const key = tableKey(table);
          const chain = {
            where: () => chain,
            orderBy: () => chain,
            limit: (n: number) => Promise.resolve(store[key].slice(0, n)),
            // biome-ignore lint/suspicious/noThenProperty: mock-db.ts promise-like drizzle select chain
            then: (resolve: (rows: unknown[]) => void) =>
              Promise.resolve([...store[key]]).then(resolve),
          };
          return chain;
        },
      };
    },
    insert: (table: object) => ({
      values: (vals: Record<string, unknown> | Record<string, unknown>[]) => {
        const key = tableKey(table);
        const items = Array.isArray(vals) ? vals : [vals];
        for (const item of items) {
          store[key].push({ ...item });
        }
        return { returning: () => Promise.resolve(items) };
      },
    }),
    update: (table: object) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          const key = tableKey(table);
          updateCallCount += 1;
          const updated = store[key].map((row) => ({ ...row, ...vals }));
          store[key] = updated;
          return { returning: () => Promise.resolve(updated) };
        },
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    execute: async () => [{ ok: 1 }],
  };

  return {
    db: db as Database["db"],
    client: { end: async () => {} } as Database["client"],
    store,
    getUpdateCallCount: () => updateCallCount,
  };
}
