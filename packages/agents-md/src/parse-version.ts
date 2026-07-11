import { AGENTS_MD_MARKER } from "./templates.js";

const VERSION_PATTERN = /<!--\s*visboard-agents-md:(\d+)\s*-->/;

export function parseAgentsMdVersion(content: string): number | null {
  const match = content.match(VERSION_PATTERN);
  if (!match?.[1]) return null;
  const version = Number.parseInt(match[1], 10);
  return Number.isNaN(version) ? null : version;
}

export function hasAgentsMdMarker(content: string): boolean {
  return content.includes(AGENTS_MD_MARKER);
}
