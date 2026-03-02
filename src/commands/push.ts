import { defineCommand } from "citty";
import { consola } from "consola";
import { loadConfig, validateConfig, resolveConfig, resolveApps, getWorkerName } from "../core/config.ts";
import { resolveAppEnv } from "../core/resolver.ts";
import { checkWrangler, pushSecrets, updateWranglerVars } from "../core/wrangler.ts";
import type { EnvMap } from "../types/env.ts";

function parseAppNames(args: { _?: string[] }, skip = 1): string[] | undefined {
  const rest = args._?.slice(skip);
  return rest?.length ? rest : undefined;
}

export default defineCommand({
  meta: {
    name: "push",
    description: "Push secrets (wrangler) and vars (wrangler.jsonc) to Cloudflare Workers",
  },
  args: {
    env: {
      type: "positional",
      description: "Target environment (e.g. staging, production)",
      required: true,
    },
    "dry-run": {
      type: "boolean",
      description: "Show what would be pushed without pushing",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Skip confirmation prompt",
      default: false,
    },
    shared: {
      type: "boolean",
      description: "Push only shared secrets",
      default: false,
    },
  },
  async run({ args }) {
    const environment = args.env as string;

    if (environment === "local") {
      consola.error('Cannot push to "local". Use `envsync dev` instead.');
      process.exit(1);
    }

    if (!args["dry-run"]) {
      const hasWrangler = await checkWrangler();
      if (!hasWrangler) {
        consola.error("wrangler CLI not found. Install it with: npm i -D wrangler");
        process.exit(1);
      }
    }

    const rawConfig = await loadConfig();
    const errors = validateConfig(rawConfig);
    if (errors.length > 0) {
      for (const err of errors) consola.error(err);
      process.exit(1);
    }

    const config = resolveConfig(rawConfig);

    if (!config.environments.includes(environment)) {
      consola.error(
        `Unknown environment: "${environment}". Available: ${config.environments.join(", ")}`,
      );
      process.exit(1);
    }

    const appNames = parseAppNames(args as unknown as { _?: string[] });
    const apps = resolveApps(config, appNames);

    if (apps.length === 0) {
      consola.warn("No apps to process.");
      return;
    }

    // Show a summary when --force is used, especially for production
    if (args.force && !args["dry-run"]) {
      const targets = apps
        .map((app) => {
          const w = getWorkerName(app, environment);
          return w ? `${app.name} → ${w}` : null;
        })
        .filter(Boolean);
      if (targets.length > 0) {
        consola.warn(
          `Force-pushing to ${environment}: ${targets.join(", ")}`,
        );
      }
    }

    const sharedKeys = new Set(config.raw.shared ?? []);
    let hasFailure = false;

    // Show --shared summary when used
    if (args.shared) {
      if (sharedKeys.size === 0) {
        consola.error("No shared keys defined in config. Nothing to push with --shared.");
        process.exit(1);
      }
      consola.info(`--shared: pushing only shared keys (${[...sharedKeys].join(", ")})`);
    }

    for (let i = 0; i < apps.length; i++) {
      const app = apps[i]!;
      const progress = apps.length > 1 ? `[${i + 1}/${apps.length}] ` : "";
      const workerName = getWorkerName(app, environment);
      if (!workerName) {
        consola.warn(`${progress}No worker defined for ${app.name} in ${environment}. Skipping.`);
        continue;
      }

      consola.start(`${progress}Pushing ${app.name} → ${workerName} (${environment})...`);

      const resolved = await resolveAppEnv(config, app, environment);
      let secretsToPush: EnvMap;
      let varsToPush: EnvMap;

      const secretKeySet = new Set(app.secrets ?? []);
      const varsKeySet = new Set(app.vars ?? []);

      if (args.shared) {
        // Only push shared keys
        secretsToPush = {};
        varsToPush = {};
        for (const [key, value] of Object.entries(resolved.map)) {
          if (sharedKeys.has(key)) {
            if (secretKeySet.has(key)) {
              secretsToPush[key] = value;
            } else if (varsKeySet.has(key)) {
              varsToPush[key] = value;
            }
          }
        }
      } else {
        // Push secrets via wrangler, vars to wrangler.jsonc
        secretsToPush = {};
        varsToPush = {};
        for (const [key, value] of Object.entries(resolved.map)) {
          if (secretKeySet.has(key)) {
            secretsToPush[key] = value;
          } else if (varsKeySet.has(key)) {
            varsToPush[key] = value;
          }
        }
      }

      const secretCount = Object.keys(secretsToPush).length;
      const varsCount = Object.keys(varsToPush).length;

      if (secretCount === 0 && varsCount === 0) {
        const reason = args.shared ? " (no shared keys for this app)" : "";
        consola.warn(`  Nothing to push for ${app.name}${reason}. Skipping.`);
        continue;
      }

      if (args["dry-run"]) {
        if (secretCount > 0) {
          consola.info(`  Would push ${secretCount} secrets to worker "${workerName}"`);
          for (const key of Object.keys(secretsToPush)) {
            const isShared = sharedKeys.has(key) ? " (shared)" : "";
            consola.log(`    ${key}${isShared}`);
          }
        }
        if (varsCount > 0) {
          consola.info(`  Would write ${varsCount} vars to wrangler config`);
          for (const key of Object.keys(varsToPush)) {
            const isShared = sharedKeys.has(key) ? " (shared)" : "";
            consola.log(`    ${key}${isShared}`);
          }
        }
        continue;
      }

      if (!args.force) {
        const parts: string[] = [];
        if (secretCount > 0) parts.push(`${secretCount} secrets`);
        if (varsCount > 0) parts.push(`${varsCount} vars`);
        const confirmed = await consola.prompt(
          `  Push ${parts.join(" + ")} to "${workerName}" (${environment})?`,
          { type: "confirm" },
        );
        if (!confirmed) {
          consola.info(`  Skipped ${app.name}.`);
          continue;
        }
      }

      // Push secrets via wrangler secret bulk
      if (secretCount > 0) {
        const result = await pushSecrets(
          workerName,
          secretsToPush,
          environment,
          app.absolutePath,
        );

        if (result.success) {
          consola.success(`  Pushed ${secretCount} secrets to ${workerName}`);
        } else {
          consola.error(`  Failed to push secrets to ${workerName}`);
          hasFailure = true;
        }
      }

      // Write vars to wrangler.jsonc
      if (varsCount > 0) {
        const varsResult = await updateWranglerVars(app.absolutePath, environment, varsToPush);
        if (varsResult.success) {
          consola.success(`  Wrote ${varsCount} vars to ${varsResult.filePath}`);
        } else {
          consola.error(`  No wrangler.jsonc found in ${app.absolutePath}. Cannot write vars.`);
          hasFailure = true;
        }
      }
    }

    if (hasFailure) {
      consola.error("Some pushes failed.");
      process.exit(1);
    }
    consola.success("Done!");
  },
});
