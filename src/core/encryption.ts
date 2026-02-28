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
 * Find the private key from environment variables.
 */
export function findPrivateKey(env?: string): string | undefined {
  if (env) {
    const envKey = `DOTENV_PRIVATE_KEY_${env.toUpperCase()}`;
    if (process.env[envKey]) return process.env[envKey];
  }
  return process.env.DOTENV_PRIVATE_KEY;
}
