import { consola } from "consola";
import { loadConfig, validateConfig, resolveConfig } from "../core/config.ts";
import type { ResolvedConfig } from "../types/config.ts";

/**
 * Load, validate, and resolve the envsync config.
 * Exits the process with code 1 if validation fails, or if `environment`
 * is provided but not listed in the config.
 */
export async function loadResolvedConfig(
  environment?: string,
): Promise<ResolvedConfig> {
  const rawConfig = await loadConfig();
  const errors = validateConfig(rawConfig);
  if (errors.length > 0) {
    for (const err of errors) consola.error(err);
    process.exit(1);
  }

  const config = resolveConfig(rawConfig);

  if (environment !== undefined && !config.environments.includes(environment)) {
    consola.error(
      `Unknown environment: "${environment}". Available: ${config.environments.join(", ")}`,
    );
    process.exit(1);
  }

  return config;
}
