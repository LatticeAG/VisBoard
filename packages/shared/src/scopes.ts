export const Scope = {
  READ: "read",
  WRITE_NOTES: "write:notes",
  WRITE_CHECKLISTS: "write:checklists",
  WRITE_FILES: "write:files",
  WRITE_EVENTS: "write:events",
  ADMIN: "admin",
} as const;

export type ScopeValue = (typeof Scope)[keyof typeof Scope];

export const ALL_SCOPES: readonly ScopeValue[] = [
  Scope.READ,
  Scope.WRITE_NOTES,
  Scope.WRITE_CHECKLISTS,
  Scope.WRITE_FILES,
  Scope.WRITE_EVENTS,
  Scope.ADMIN,
] as const;

const IMPLIED_SCOPES: Record<ScopeValue, readonly ScopeValue[]> = {
  [Scope.READ]: [Scope.READ],
  [Scope.WRITE_NOTES]: [Scope.WRITE_NOTES],
  [Scope.WRITE_CHECKLISTS]: [Scope.WRITE_CHECKLISTS],
  [Scope.WRITE_FILES]: [Scope.WRITE_FILES],
  [Scope.WRITE_EVENTS]: [Scope.WRITE_EVENTS],
  [Scope.ADMIN]: ALL_SCOPES,
};

export function expandScopes(scopes: readonly string[]): Set<string> {
  const expanded = new Set<string>();
  for (const scope of scopes) {
    if (scope === Scope.ADMIN) {
      for (const s of ALL_SCOPES) {
        expanded.add(s);
      }
      continue;
    }
    const implied = IMPLIED_SCOPES[scope as ScopeValue];
    if (implied) {
      for (const s of implied) {
        expanded.add(s);
      }
    } else {
      expanded.add(scope);
    }
  }
  return expanded;
}

export function hasScope(granted: readonly string[], required: string): boolean {
  return expandScopes(granted).has(required);
}

export function hasAnyScope(granted: readonly string[], required: readonly string[]): boolean {
  const expanded = expandScopes(granted);
  return required.some((scope) => expanded.has(scope));
}

export function hasAllScopes(granted: readonly string[], required: readonly string[]): boolean {
  const expanded = expandScopes(granted);
  return required.every((scope) => expanded.has(scope));
}

export const DEFAULT_AGENT_SCOPES: readonly ScopeValue[] = [Scope.READ];
