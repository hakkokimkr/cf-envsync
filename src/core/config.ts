import { resolve } from "node:path";
import { createJiti } from "jiti";
import { consola } from "consola";
import type {
  AppConfig,
  EnvSyncConfig,
  ResolvedAppConfig,
  ResolvedConfig,
} from "../types/config.ts";
import { fileExists, readFile, findProjectRoot } from "../utils/fs.ts";
import type { ConfigFilename } from "../utils/fs.ts";

/**
 * Load a config file based on its extension.
 * - .ts / .js / .mjs → loaded via jiti (cross-runtime TS/ESM support)
 * - .json → JSON.parse
 * - .jsonc → strip comments + JSON.parse
 */
async function loadConfigFile(
  configPath: string,
  filename: ConfigFilename,
): Promise<EnvSyncConfig> {
  if (filename.endsWith(".json")) {
    const raw = await readFile(configPath);
    return JSON.parse(raw) as EnvSyncConfig;
  }

  if (filename.endsWith(".jsonc")) {
    const raw = await readFile(configPath);
    const stripped = raw
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    return JSON.parse(stripped) as EnvSyncConfig;
  }

  // .ts / .js / .mjs — use jiti for cross-runtime support
  const jiti = createJiti(configPath);
  const mod = await jiti.import(configPath);
  return ((mod as Record<string, unknown>).default ?? mod) as EnvSyncConfig;
}

/**
 * Load config from the project root.
 * Searches for envsync.config.ts, .js, .mjs, envsync.json, envsync.jsonc (in that order).
 */
export async function loadConfig(cwd?: string): Promise<EnvSyncConfig> {
  const found = findProjectRoot(cwd);
  if (!found) {
    throw new Error(
      "Could not find envsync config. Run `envsync init` to create one.",
    );
  }
  const configPath = resolve(found.root, found.configFile);
  return loadConfigFile(configPath, found.configFile);
}

/**
 * Validate a loaded config for required fields.
 */
export function validateConfig(config: EnvSyncConfig): string[] {
  const errors: string[] = [];

  if (
    !config.environments ||
    !Array.isArray(config.environments) ||
    config.environments.length === 0
  ) {
    errors.push('"environments" must be a non-empty array');
  }

  if (!config.envFiles?.pattern) {
    errors.push('"envFiles.pattern" is required');
  }

  if (!config.apps || Object.keys(config.apps).length === 0) {
    errors.push("No apps defined in config");
  }

  for (const [name, app] of Object.entries(config.apps ?? {})) {
    if (!app.path) {
      errors.push(`App "${name}" is missing "path" field`);
    }
    if (!app.workers || Object.keys(app.workers).length === 0) {
      errors.push(`App "${name}" is missing "workers" mapping`);
    }
    if ((!app.secrets || app.secrets.length === 0) && (!app.vars || app.vars.length === 0)) {
      errors.push(`App "${name}" has no "secrets" or "vars" declared`);
    }
  }

  return errors;
}

/**
 * Resolve config paths and compute derived fields.
 */
export function resolveConfig(
  config: EnvSyncConfig,
  cwd?: string,
): ResolvedConfig {
  const found = findProjectRoot(cwd);
  const projectRoot = found?.root ?? process.cwd();

  const apps: Record<string, ResolvedAppConfig> = {};
  for (const [name, app] of Object.entries(config.apps)) {
    const allKeys = [
      ...(app.secrets ?? []),
      ...(app.vars ?? []),
    ];

    // Add local per-app override keys
    const perAppOverrides = config.local?.perApp?.[name] ?? [];
    for (const key of perAppOverrides) {
      if (!allKeys.includes(key)) {
        allKeys.push(key);
      }
    }

    // Add global local overrides that aren't already included
    for (const key of config.local?.overrides ?? []) {
      if (!allKeys.includes(key)) {
        allKeys.push(key);
      }
    }

    apps[name] = {
      ...app,
      name,
      absolutePath: resolve(projectRoot, app.path),
      allKeys,
    };
  }

  return {
    projectRoot,
    raw: config,
    environments: config.environments,
    apps,
  };
}

/**
 * Filter apps by name. If no names given, return all.
 */
export function resolveApps(
  config: ResolvedConfig,
  appNames?: string[],
): ResolvedAppConfig[] {
  if (!appNames || appNames.length === 0) {
    return Object.values(config.apps);
  }

  const resolved: ResolvedAppConfig[] = [];
  for (const name of appNames) {
    const app = config.apps[name];
    if (!app) {
      consola.warn(`Unknown app: "${name}". Skipping.`);
      continue;
    }
    resolved.push(app);
  }
  return resolved;
}

/**
 * Get the worker name for an app in a given environment.
 */
export function getWorkerName(
  app: ResolvedAppConfig,
  environment: string,
): string | undefined {
  return app.workers[environment];
}

/**
 * Resolve env file path from the pattern.
 * "local" environment falls back to ".env" (not ".env.local").
 */
export function resolveEnvFilePath(pattern: string, env: string): string {
  if (env === "local") return ".env";
  return pattern.replace("{env}", env);
}
