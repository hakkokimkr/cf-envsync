import type { EnvSyncConfig } from "./types/config.ts";

/**
 * Define envsync configuration with full type checking and editor support.
 *
 * @example
 * ```ts
 * // envsync.config.ts
 * import { defineConfig } from "envsync";
 *
 * export default defineConfig({
 *   environments: ["local", "staging", "production"],
 *   envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: true },
 *   encryption: "dotenvx",
 *   apps: {
 *     api: {
 *       path: "apps/api",
 *       workers: { staging: "my-api-staging", production: "my-api" },
 *       secrets: ["DATABASE_URL"],
 *       vars: ["API_URL"],
 *     },
 *   },
 * });
 * ```
 */
export function defineConfig(config: EnvSyncConfig): EnvSyncConfig {
  return config;
}

export type { EnvSyncConfig, AppConfig } from "./types/config.ts";
