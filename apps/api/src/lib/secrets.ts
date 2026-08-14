import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

type SecretsEnv = {
  VISBOARD_TOKEN_PEPPER: string;
  VISBOARD_SECRETS_KEY?: string;
};

let warnedPepperFallback = false;

export function resolveSecretsKey(env: SecretsEnv): Buffer {
  if (env.VISBOARD_SECRETS_KEY) {
    return Buffer.from(env.VISBOARD_SECRETS_KEY, "hex");
  }
  if (!warnedPepperFallback) {
    warnedPepperFallback = true;
    console.error("connection secrets keyed by pepper, pepper rotation will orphan them");
  }
  return createHmac("sha256", "visboard-connection-secrets")
    .update(env.VISBOARD_TOKEN_PEPPER)
    .digest();
}

export function encryptSecret(plain: string, key: Buffer): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(secret: EncryptedSecret, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(secret.iv, "base64"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
