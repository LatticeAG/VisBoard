import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface VisBoardConfig {
  endpoint?: string;
  token?: string;
  workspace?: string;
}

const CONFIG_DIR = path.join(homedir(), ".config", "visboard");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export const DEFAULT_ENDPOINT = "http://localhost:8080/v1";

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export async function loadConfig(): Promise<VisBoardConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as VisBoardConfig;
  } catch {
    return {};
  }
}

export async function saveConfig(config: VisBoardConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function updateConfig(
  patch: Partial<VisBoardConfig>,
): Promise<VisBoardConfig> {
  const current = await loadConfig();
  const next = { ...current, ...patch };
  await saveConfig(next);
  return next;
}

export async function clearConfigKey(
  key: keyof VisBoardConfig,
): Promise<VisBoardConfig> {
  const current = await loadConfig();
  const next = { ...current };
  delete next[key];
  await saveConfig(next);
  return next;
}
