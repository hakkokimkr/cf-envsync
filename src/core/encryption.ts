import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@dotenvx/dotenvx";
import { scryptSync, randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { parsePlainEnv } from "../utils/env-parse.ts";

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
 * Load key-value pairs from a `.env.keys` or `.env.password` file.
 * Returns an empty object if the file does not exist.
 */
function loadEnvKeysFileSync(filePath: string): Record<string, string> {
  try {
    return parsePlainEnv(readFileSync(filePath, "utf-8"));
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
 * Cache for scrypt-derived keys, keyed by a hash of (salt, password).
 *
 * Why this exists (measured on enter.fun, 2026-09-28):
 *
 * Every encrypted value carries its own random salt, so `decryptValue` runs a
 * fresh `scryptSync` per value — by design, and correct. The waste is one level
 * up: `resolveAppEnv` re-reads and re-decrypts the *whole* root `.env.<env>`
 * once per app, so the same (salt, password) pairs are derived over and over.
 *
 *   66 encrypted values x 13 apps = 858 scryptSync calls per `envsync dev`
 *   858 calls = 16.0s on an M-series Mac, ~32s on a 2-vCPU CI runner
 *   (matches the 32.1s measured for the "Decrypt env files" step in CI)
 *
 * With this cache only 66 derivations survive (-92%), because the 13 repeats
 * per value are now lookups. scrypt stays exactly as slow as it is supposed to
 * be for an *attacker* — a second derivation of an identical (salt, password)
 * pair protects nothing, it just costs us 19ms.
 *
 * Scope and lifetime: a plain Map for the lifetime of the CLI process. The CLI
 * already holds every decrypted secret in memory and writes them to disk, so
 * keeping the derived keys alongside them does not widen the blast radius in
 * any way that matters. The cache key is hashed rather than storing the raw
 * password as a Map key — cheap defence in depth, nothing more.
 */
const derivedKeyCache = new Map<string, Buffer>();

/**
 * Derive the AES key for a (password, salt) pair, reusing a previous result.
 *
 * ⚠️ Must stay a pure function of its inputs — same inputs, same 32 bytes.
 *    Do not add per-call state here or the cache becomes wrong, not just slow.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  const cacheKey = createHash("sha256")
    .update(salt)
    .update(Buffer.from([0]))
    .update(password, "utf8")
    .digest("base64");
  const cached = derivedKeyCache.get(cacheKey);
  if (cached) return cached;
  const key = scryptSync(password, salt, 32);
  derivedKeyCache.set(cacheKey, key);
  return key;
}

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
  // 같은 (비밀번호, salt) 쌍은 재사용한다 — 위 derivedKeyCache 주석 참조.
  // encryptValue 는 매번 새 salt 를 뽑으므로 캐시를 쓰지 않는다(적중 0 · 메모리만 는다).
  const key = deriveKey(password, salt);
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
    if (isEnvsyncEncrypted(value)) {
      try {
        result[key] = decryptValue(value, password);
      } catch {
        throw new Error(
          `Failed to decrypt ${key}: wrong password or corrupted data. ` +
          `Check ENVSYNC_PASSWORD or .env.password`,
        );
      }
    } else {
      result[key] = value;
    }
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
