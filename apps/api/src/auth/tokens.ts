import { createHash, randomBytes } from "node:crypto";

const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function hashToken(token: string, pepper: string): string {
  return createHash("sha256")
    .update(token + pepper)
    .digest("hex");
}

export function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}

function randomBase62(length: number): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      result += BASE62[byte % 62];
    }
  }
  return result;
}

export function generatePatToken(): string {
  return `vb_pat_${randomBase62(32)}`;
}

export function generateAgentToken(): string {
  return `vb_agent_${randomBase62(32)}`;
}

export function isPatToken(token: string): boolean {
  return token.startsWith("vb_pat_");
}

export function isAgentToken(token: string): boolean {
  return token.startsWith("vb_agent_");
}
