import { normalize } from "node:path";
import type { ResolvedAppConfig, ResolvedConfig } from "../types/config.ts";
import type { EnvMap, ResolvedEnv } from "../types/env.ts";
import {
  loadEnvFile,
  mergeEnvLayers,
  filterForApp,
  getRootEnvPath,
  getAppEnvPath,
  getLocalOverridePath,
} from "./env-file.ts";

/**
 * Resolve the full env map for an app in a given environment.
 * Merge order: root .env.{env} → app .env.{env} → .env.local (local only)
 */
export async function resolveAppEnv(
  config: ResolvedConfig,
  app: ResolvedAppConfig,
  environment: string,
): Promise<ResolvedEnv> {
  const layers: { source: string; map: EnvMap }[] = [];

  // Layer 1: Root .env.{env}
  const rootEnvPath = getRootEnvPath(config, environment);
  const rootEnv = await loadEnvFile(rootEnvPath, environment, config.projectRoot);
  if (Object.keys(rootEnv).length > 0) {
    layers.push({ source: rootEnvPath, map: rootEnv });
  }

  // Layer 2: App-specific .env.{env} (if perApp enabled)
  if (config.raw.envFiles.perApp) {
    const appEnvPath = getAppEnvPath(config, app, environment);
    if (normalize(appEnvPath) !== normalize(rootEnvPath)) {
      const appEnv = await loadEnvFile(appEnvPath, environment, config.projectRoot);
      if (Object.keys(appEnv).length > 0) {
        layers.push({ source: appEnvPath, map: appEnv });
      }
    }
  }

  // Layer 3: .env.local (only for local environment)
  if (environment === "local") {
    const localPath = getLocalOverridePath(config);
    const localEnv = await loadEnvFile(localPath);
    if (Object.keys(localEnv).length > 0) {
      layers.push({ source: localPath, map: localEnv });
    }
  }

  const resolved = mergeEnvLayers(layers);

  // Filter to only keys declared for this app
  const filteredMap = filterForApp(resolved.map, app);

  return {
    map: filteredMap,
    entries: resolved.entries.filter((e) => e.key in filteredMap),
    layers: resolved.layers,
  };
}

/**
 * Find keys that appear in all apps (shared across apps).
 */
export function findSharedValues(
  appEnvs: Map<string, EnvMap>,
): { key: string; value: string }[] {
  const allApps = Array.from(appEnvs.values());
  if (allApps.length === 0) return [];

  const firstApp = allApps[0]!;
  const shared: { key: string; value: string }[] = [];

  for (const [key, value] of Object.entries(firstApp)) {
    const isShared = allApps.every((env) => env[key] === value);
    if (isShared) {
      shared.push({ key, value });
    }
  }

  return shared;
}

/**
 * Check for missing per-developer override keys.
 * Returns keys that are declared in local.overrides or local.perApp
 * but not present in .env.local.
 */
export function findMissingOverrides(
  config: ResolvedConfig,
  app: ResolvedAppConfig,
  localEnv: EnvMap,
): string[] {
  const missing: string[] = [];

  // Global overrides
  for (const key of config.raw.local?.overrides ?? []) {
    if (app.allKeys.includes(key) && !(key in localEnv)) {
      missing.push(key);
    }
  }

  // Per-app overrides
  for (const key of config.raw.local?.perApp?.[app.name] ?? []) {
    if (!(key in localEnv)) {
      missing.push(key);
    }
  }

  return missing;
}
