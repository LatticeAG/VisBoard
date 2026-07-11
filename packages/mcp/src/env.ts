export interface McpConfig {
  baseUrl: string;
  token: string;
}

export function loadConfig(): McpConfig {
  const baseUrl = process.env.VISBOARD_API_URL ?? "http://localhost:8080/v1";
  const token = process.env.VISBOARD_TOKEN;

  if (!token) {
    throw new Error("VISBOARD_TOKEN environment variable is required");
  }

  return { baseUrl, token };
}
