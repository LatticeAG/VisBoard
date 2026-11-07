import { z } from "zod";

export const DISALLOWED_PEPPERS = new Set([
  "change-me-in-production-min-32-chars",
  "ci-pepper-change-me-in-production-min-32-chars",
  "test-pepper-change-me-in-production-min-32",
  "dev-pepper-change-me",
]);

const envBoolean = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "off"].includes(normalized)) return false;
    }
    return value;
  }, z.boolean());

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8080),
  API_BASE_URL: z.string().url().default("http://localhost:8080"),
  VISBOARD_DATA_DIR: z.string().min(1).default("./data"),
  VISBOARD_TOKEN_PEPPER: z.string().min(32),
  VISBOARD_BOOTSTRAP_TOKEN: z.string().optional(),
  VISBOARD_CORS_ORIGIN: z.string().default("http://localhost:3000"),
  VISBOARD_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(600),
  VISBOARD_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
  VISBOARD_AUTO_MIGRATE: envBoolean(false),
  VISBOARD_ALLOW_INSECURE_DEFAULTS: envBoolean(false),
  NODE_ENV: z.string().default("development"),
  VISBOARD_SECRETS_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .length(64)
      .regex(/^[0-9a-f]+$/)
      .optional(),
  ),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

export function databaseUsesDemoCredentials(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    return parsed.username === "visboard" && parsed.password === "visboard";
  } catch {
    return false;
  }
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(`Invalid environment variables: ${JSON.stringify(parsed.error.flatten())}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    if (
      env.VISBOARD_TOKEN_PEPPER.length < 32 ||
      DISALLOWED_PEPPERS.has(env.VISBOARD_TOKEN_PEPPER)
    ) {
      throw new EnvError(
        "VISBOARD_TOKEN_PEPPER is a disallowed example value or shorter than 32 characters in production",
      );
    }
    if (databaseUsesDemoCredentials(env.DATABASE_URL) && !env.VISBOARD_ALLOW_INSECURE_DEFAULTS) {
      throw new EnvError(
        "Refusing production boot with default visboard/visboard database credentials. Set POSTGRES_PASSWORD and DATABASE_URL together, or VISBOARD_ALLOW_INSECURE_DEFAULTS=1",
      );
    }
  } else if (DISALLOWED_PEPPERS.has(env.VISBOARD_TOKEN_PEPPER)) {
    console.error(
      "Warning: VISBOARD_TOKEN_PEPPER is a documented example value. Change it before production.",
    );
  }
  return env;
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) {
    try {
      cached = parseEnv(process.env);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
  return cached;
}

export function resetEnvForTests(overrides: Record<string, string | number | boolean> = {}): Env {
  const defaults: Record<string, string | number | boolean> = {
    DATABASE_URL: "postgresql://visboard:visboard@localhost:5433/visboard",
    PORT: 8080,
    API_BASE_URL: "http://localhost:8080",
    VISBOARD_DATA_DIR: "./data",
    VISBOARD_TOKEN_PEPPER: "test-pepper-change-me-in-production-min-32",
    VISBOARD_CORS_ORIGIN: "http://localhost:3000",
    VISBOARD_RATE_LIMIT_RPM: 600,
    VISBOARD_MAX_FILE_BYTES: 10 * 1024 * 1024,
    VISBOARD_AUTO_MIGRATE: false,
    VISBOARD_ALLOW_INSECURE_DEFAULTS: false,
    NODE_ENV: "test",
    ...overrides,
  };
  for (const [key, value] of Object.entries(defaults)) {
    process.env[key] = String(value);
  }
  cached = null;
  cached = parseEnv(process.env);
  return cached;
}
