import { VisBoardClient } from "@visboard/sdk";
import { DEFAULT_ENDPOINT, loadConfig } from "./config.js";
import type { GlobalOptions } from "./output.js";

export async function createClient(
  options: GlobalOptions,
): Promise<{ client: VisBoardClient; workspace?: string }> {
  const config = await loadConfig();
  const baseUrl = options.endpoint ?? config.endpoint ?? DEFAULT_ENDPOINT;
  const token = config.token;
  const workspace = options.workspace ?? config.workspace;

  const client = new VisBoardClient({ baseUrl, token });
  return { client, workspace };
}

export function requireWorkspace(workspace: string | undefined): string {
  if (!workspace) {
    throw new Error(
      "No workspace configured. Use --workspace <slug> or `visboard workspace switch <slug>`.",
    );
  }
  return workspace;
}

export function requireToken(token: string | undefined): string {
  if (!token) {
    throw new Error(
      "No token configured. Run `visboard auth set-token <token>` or `visboard auth bootstrap`.",
    );
  }
  return token;
}
