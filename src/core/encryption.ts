import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@dotenvx/dotenvx";
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Parse and decrypt .env file content using dotenvx.
 * If the file is encrypted, DOTENV_PRIVATE_KEY (or env-specific key) must be set.
 */
export function decryptEnvContent(
  content: string,
  privateKey?: string,
): Record<string, string> {
  if (privateKey) {
    // Temporarily set the key for dotenvx parsing
    const prev = process.env.DOTENV_PRIVATE_KEY;
    process.env.DOTENV_PRIVATE_KEY = privateKey;
    try {
      return parse(content) as Record<string, string>;
    } finally {
      if (prev !== undefined) {
        process.env.DOTENV_PRIVATE_KEY = prev;
      } else {
        delete process.env.DOTENV_PRIVATE_KEY;
      }
    }
  }
  return parse(content) as Record<string, string>;
}

/**
 * Load key-value pairs from a `.env.keys` file.
 * Lines starting with `#` or blank lines are ignored.
 */
function loadEnvKeysFileSync(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Find the private key from environment variables.
 * Falls back to reading `.env.keys` file in projectRoot if no env var is set.
 *
 * Priority: env var (env-specific > generic) > `.env.keys` file
 */
export function findPrivateKey(env?: string, projectRoot?: string): string | undefined {
  if (env) {
    const envKey = `DOTENV_PRIVATE_KEY_${env.toUpperCase()}`;
    if (process.env[envKey]) return process.env[envKey];
  }
  if (process.env.DOTENV_PRIVATE_KEY) return process.env.DOTENV_PRIVATE_KEY;

  // Fallback: read .env.keys file
  if (projectRoot) {
    const keysFile = loadEnvKeysFileSync(join(projectRoot, ".env.keys"));
    if (env) {
      const envKey = `DOTENV_PRIVATE_KEY_${env.toUpperCase()}`;
      if (keysFile[envKey]) return keysFile[envKey];
    }
    if (keysFile.DOTENV_PRIVATE_KEY) return keysFile.DOTENV_PRIVATE_KEY;
  }

  return undefined;
}

// --- Password-based encryption (AES-256-GCM) ---

const ENVSYNC_PREFIX = "envsync:v1:";

/**
 * Check if a value is encrypted with envsync password encryption.
 */
export function isEnvsyncEncrypted(value: string): boolean {
  return value.startsWith(ENVSYNC_PREFIX);
}

/**
 * Encrypt a plaintext value with AES-256-GCM using a password.
 * Returns `envsync:v1:{base64(salt+iv+ciphertext+tag)}`.
 */
export function encryptValue(plaintext: string, password: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([salt, iv, encrypted, tag]);
  return ENVSYNC_PREFIX + payload.toString("base64");
}

/**
 * Decrypt an envsync-encrypted token with the given password.
 */
export function decryptValue(token: string, password: string): string {
  if (!token.startsWith(ENVSYNC_PREFIX)) {
    throw new Error("Not an envsync-encrypted value");
  }
  const payload = Buffer.from(token.slice(ENVSYNC_PREFIX.length), "base64");
  const salt = payload.subarray(0, 16);
  const iv = payload.subarray(16, 28);
  const tag = payload.subarray(payload.length - 16);
  const encrypted = payload.subarray(28, payload.length - 16);
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

/**
 * Decrypt all envsync-encrypted values in an env map.
 * Non-encrypted values are passed through unchanged.
 */
export function decryptEnvMap(envMap: Record<string, string>, password: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(envMap)) {
    result[key] = isEnvsyncEncrypted(value) ? decryptValue(value, password) : value;
  }
  return result;
}

/**
 * Encrypt all plaintext values in an env map.
 * Already-encrypted values are passed through unchanged.
 * Empty values are left as-is.
 */
export function encryptEnvMap(envMap: Record<string, string>, password: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(envMap)) {
    if (isEnvsyncEncrypted(value) || value === "") {
      result[key] = value;
    } else {
      result[key] = encryptValue(value, password);
    }
  }
  return result;
}

/**
 * Find the password for envsync password encryption.
 * Priority: env var (env-specific > generic) > `.env.password` file
 */
export function findPassword(env?: string, projectRoot?: string): string | undefined {
  if (env) {
    const envKey = `ENVSYNC_PASSWORD_${env.toUpperCase()}`;
    if (process.env[envKey]) return process.env[envKey];
  }
  if (process.env.ENVSYNC_PASSWORD) return process.env.ENVSYNC_PASSWORD;

  // Fallback: read .env.password file
  if (projectRoot) {
    const passwordFile = loadEnvKeysFileSync(join(projectRoot, ".env.password"));
    if (env) {
      const envKey = `ENVSYNC_PASSWORD_${env.toUpperCase()}`;
      if (passwordFile[envKey]) return passwordFile[envKey];
    }
    if (passwordFile.ENVSYNC_PASSWORD) return passwordFile.ENVSYNC_PASSWORD;
  }

  return undefined;
}
