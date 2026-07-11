import { z } from "zod";

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
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error("Invalid environment variables:", parsed.error.flatten());
      process.exit(1);
    }
    cached = parsed.data;
  }
  return cached;
}

export function resetEnvForTests(overrides: Partial<Env> = {}): Env {
  const defaults: Record<string, string | number> = {
    DATABASE_URL: "postgresql://visboard:visboard@localhost:5432/visboard",
    PORT: 8080,
    API_BASE_URL: "http://localhost:8080",
    VISBOARD_DATA_DIR: "./data",
    VISBOARD_TOKEN_PEPPER: "test-pepper-change-me-in-production-min-32",
    VISBOARD_CORS_ORIGIN: "http://localhost:3000",
    VISBOARD_RATE_LIMIT_RPM: 600,
    VISBOARD_MAX_FILE_BYTES: 10 * 1024 * 1024,
    ...overrides,
  };
  for (const [key, value] of Object.entries(defaults)) {
    process.env[key] = String(value);
  }
  cached = null;
  return getEnv();
}
