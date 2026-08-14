import { VisBoardClient } from "@visboard/sdk";
import { getApiUrl, getToken } from "./auth";

function v2BaseUrl(): string {
  const configured = getApiUrl().replace(/\/$/, "");
  if (configured.endsWith("/v1")) return `${configured.slice(0, -3)}/v2`;
  if (configured.endsWith("/v2")) return configured;
  return `${configured}/v2`;
}

/** V2 keeps a separate client because the legacy UI still targets `/v1`. */
export function getV2Client(): VisBoardClient {
  return new VisBoardClient({
    baseUrl: v2BaseUrl(),
    token: typeof window === "undefined" ? undefined : (getToken() ?? undefined),
  });
}
