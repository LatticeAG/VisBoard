export function resolveResetDatabaseUrl(environmentUrl?: string, envFileUrl?: string): string {
  return environmentUrl || envFileUrl || "postgresql://visboard:visboard@localhost:5433/visboard";
}
