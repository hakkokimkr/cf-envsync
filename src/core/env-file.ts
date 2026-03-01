import { join } from "node:path";
import { consola } from "consola";
import { decryptEnvContent, findPrivateKey, findPassword, decryptEnvMap } from "./encryption.ts";
import { resolveEnvFilePath } from "./config.ts";
import { fileExists, readFile, writeFile } from "../utils/fs.ts";
import type { EnvEntry, EnvMap, ResolvedEnv } from "../types/env.ts";
import type { ResolvedAppConfig, ResolvedConfig } from "../types/config.ts";

/**
 * Parse plain KEY=VALUE content into an EnvMap.
 * Handles comments, blank lines, and quoted values.
 */
export function parsePlainEnv(content: string): EnvMap {
  const result: EnvMap = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Load a .env file and parse its contents.
 * Supports dotenvx-encrypted and password-encrypted files.
 */
export async function loadEnvFile(
  filePath: string,
  env?: string,
  projectRoot?: string,
  encryption?: "dotenvx" | "password" | "none",
): Promise<EnvMap> {
  if (!fileExists(filePath)) {
    return {};
  }
  const content = await readFile(filePath);

  // Detect encryption format mismatch
  if (encryption) {
    const hasEnvsyncValues = content.includes("envsync:v1:");
    const hasDotenvxValues = content.includes("encrypted:");

    if (encryption === "dotenvx" && hasEnvsyncValues) {
      consola.warn(
        `${filePath}: config uses encryption: "dotenvx" but file contains "envsync:v1:" (password-encrypted) values. ` +
        `Check your encryption setting.`,
      );
    }
    if (encryption === "password" && hasDotenvxValues && !hasEnvsyncValues) {
      consola.warn(
        `${filePath}: config uses encryption: "password" but file contains dotenvx-encrypted values. ` +
        `Check your encryption setting.`,
      );
    }
  }

  if (encryption === "password") {
    const envMap = parsePlainEnv(content);
    const password = findPassword(env, projectRoot);
    if (!password) return envMap;
    return decryptEnvMap(envMap, password);
  }

  const privateKey = findPrivateKey(env, projectRoot);
  return decryptEnvContent(content, privateKey);
}

/**
 * Write an env map to a file in KEY=VALUE format.
 */
export async function writeEnvFile(
  filePath: string,
  envMap: EnvMap,
): Promise<void> {
  const lines = Object.entries(envMap)
    .map(([key, value]) => {
      const needsQuote = /[\s"'#\\]/.test(value) || value === "";
      const quoted = needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value;
      return `${key}=${quoted}`;
    })
    .join("\n");
  await writeFile(filePath, lines + "\n");
}

/**
 * Merge multiple env layers in order (later layers override earlier).
 * Returns entries with source tracking.
 */
export function mergeEnvLayers(
  layers: { source: string; map: EnvMap }[],
): ResolvedEnv {
  const entryMap = new Map<string, EnvEntry>();

  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.map)) {
      entryMap.set(key, { key, value, source: layer.source });
    }
  }

  const entries = Array.from(entryMap.values());
  const map: EnvMap = {};
  for (const entry of entries) {
    map[entry.key] = entry.value;
  }

  return {
    entries,
    map,
    layers: layers.map((l) => l.source),
  };
}

/**
 * Filter an env map to only include keys declared for an app.
 */
export function filterForApp(
  envMap: EnvMap,
  app: ResolvedAppConfig,
): EnvMap {
  const allowedKeys = new Set(app.allKeys);
  const filtered: EnvMap = {};
  for (const [key, value] of Object.entries(envMap)) {
    if (allowedKeys.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Get the root env file path for an environment.
 */
export function getRootEnvPath(
  config: ResolvedConfig,
  environment: string,
): string {
  const pattern = config.raw.envFiles.pattern;
  const relativePath = resolveEnvFilePath(pattern, environment);
  return join(config.projectRoot, relativePath);
}

/**
 * Get the app-specific env file path for an environment.
 */
export function getAppEnvPath(
  config: ResolvedConfig,
  app: ResolvedAppConfig,
  environment: string,
): string {
  const pattern = config.raw.envFiles.pattern;
  const relativePath = resolveEnvFilePath(pattern, environment);
  return join(app.absolutePath, relativePath);
}

/**
 * Get the local override file path.
 */
export function getLocalOverridePath(config: ResolvedConfig): string {
  return join(config.projectRoot, config.raw.envFiles.local);
}
