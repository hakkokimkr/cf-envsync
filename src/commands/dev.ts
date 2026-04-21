import { defineCommand } from "citty";
import { join, relative } from "node:path";
import { consola } from "consola";
import { resolveApps } from "../core/config.ts";
import { resolveAppEnv, findMissingOverrides } from "../core/resolver.ts";
import { writeEnvFile, getLocalOverridePath, loadEnvFile } from "../core/env-file.ts";
import { parseAppNames } from "../utils/args.ts";
import { loadResolvedConfig } from "../utils/command.ts";

/**
 * Format a source path for display: relative path + annotation.
 * e.g. ".env (shared)", ".env.local (per-dev override)", "apps/api/.env"
 */
function formatSource(
  source: string,
  key: string,
  projectRoot: string,
  sharedKeys: Set<string>,
  localOverrideKeys: Set<string>,
): string {
  const rel = relative(projectRoot, source);
  if (localOverrideKeys.has(key)) return `${rel} (per-dev override)`;
  if (sharedKeys.has(key)) return `${rel} (shared)`;
  return rel;
}

export default defineCommand({
  meta: {
    name: "dev",
    description: "Generate .dev.vars files for local development",
  },
  args: {
    env: {
      type: "string",
      description: "Environment to use (default: local)",
      default: "local",
    },
    "dry-run": {
      type: "boolean",
      description: "Show what would be written without writing files",
      default: false,
    },
  },
  async run({ args }) {
    const environment = args.env || "local";

    const config = await loadResolvedConfig();
    const appNames = parseAppNames(args as unknown as { _?: string[] }, 0);
    const apps = resolveApps(config, appNames);

    if (apps.length === 0) {
      consola.warn("No apps to process.");
      return;
    }

    // Precompute annotation sets
    const sharedKeys = new Set(config.raw.shared ?? []);
    const localOverrideKeys = new Set([
      ...(config.raw.local?.overrides ?? []),
      ...Object.values(config.raw.local?.perApp ?? {}).flat(),
    ]);

    // Load local overrides for missing-override checks
    const localOverridePath = getLocalOverridePath(config);
    const localEnv = await loadEnvFile(localOverridePath);

    for (const app of apps) {
      const resolved = await resolveAppEnv(config, app, environment);

      if (Object.keys(resolved.map).length === 0) {
        consola.warn(`  No env vars resolved for ${app.name}. Skipping.`);
        continue;
      }

      for (const devFileName of app.devFiles) {
        const devFilePath = join(app.absolutePath, devFileName);
        const relDevFile = relative(config.projectRoot, devFilePath);

        if (args["dry-run"]) {
          consola.log(`\n  ${relDevFile}`);
        } else {
          await writeEnvFile(devFilePath, resolved.map);
          consola.log(`\n  ${relDevFile}`);
        }

        for (let i = 0; i < resolved.entries.length; i++) {
          const entry = resolved.entries[i]!;
          const isLast = i === resolved.entries.length - 1;
          const prefix = isLast ? "\u2514" : "\u251C";
          const src = formatSource(entry.source, entry.key, config.projectRoot, sharedKeys, localOverrideKeys);
          consola.log(`  ${prefix} ${entry.key.padEnd(24)} \u2190 ${src}`);
        }
      }

      // Check for missing per-dev overrides (only in local env)
      if (environment === "local") {
        const missing = findMissingOverrides(config, app, localEnv);
        if (missing.length > 0) {
          for (const key of missing) {
            consola.warn(`\n\u26A0 Missing in ${relative(config.projectRoot, localOverridePath)}: ${key} (required per-dev override)`);
            consola.log(`  \u2192 echo "${key}=<your-value>" >> ${relative(config.projectRoot, localOverridePath)}`);
          }
        }
      }
    }

    if (environment !== "local") {
      const hasOverrides = (config.raw.local?.overrides?.length ?? 0) > 0 ||
        Object.keys(config.raw.local?.perApp ?? {}).length > 0;
      if (hasOverrides) {
        consola.info(`Per-dev overrides are only applied in "local" environment (current: ${environment}).`);
      }
    }

    consola.success("\nDone!");
  },
});
