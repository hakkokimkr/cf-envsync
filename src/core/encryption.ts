import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "@dotenvx/dotenvx";

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
