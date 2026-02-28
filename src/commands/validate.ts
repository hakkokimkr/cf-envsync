import { defineCommand } from "citty";
import { join } from "node:path";
import { consola } from "consola";
import { loadConfig, validateConfig, resolveConfig, resolveApps } from "../core/config.ts";
import { resolveAppEnv, findMissingOverrides } from "../core/resolver.ts";
import { loadEnvFile, getLocalOverridePath } from "../core/env-file.ts";
import { fileExists } from "../utils/fs.ts";
import type { ValidationResult } from "../types/env.ts";

function parseAppNames(args: { _?: string[] }, skip = 1): string[] | undefined {
  const rest = args._?.slice(skip);
  return rest?.length ? rest : undefined;
}

export default defineCommand({
  meta: {
    name: "validate",
    description: "Validate env vars against .env.example",
  },
  args: {
    env: {
      type: "positional",
      description: "Environment to validate (omit for all)",
      required: false,
    },
  },
  async run({ args }) {
    const rawConfig = await loadConfig();
    const errors = validateConfig(rawConfig);
    if (errors.length > 0) {
      for (const err of errors) consola.error(err);
      process.exit(1);
    }

    const config = resolveConfig(rawConfig);

    // Determine which environments to validate
    const envArg = args.env as string | undefined;
    let environments: string[];
    let appNames: string[] | undefined;

    if (envArg && config.environments.includes(envArg)) {
      environments = [envArg];
      appNames = parseAppNames(args as unknown as { _?: string[] });
    } else if (envArg) {
      // First arg is not an env — treat all args as app names, validate all envs
      environments = config.environments;
      appNames = parseAppNames(args as unknown as { _?: string[] }, 0);
    } else {
      environments = config.environments;
      appNames = undefined;
    }

    const apps = resolveApps(config, appNames);

    // Load .env.example as reference
    const examplePath = join(config.projectRoot, ".env.example");
    if (!fileExists(examplePath)) {
      consola.error("No .env.example found at project root.");
      process.exit(1);
    }
    const exampleEnv = await loadEnvFile(examplePath);
    const exampleKeys = new Set(Object.keys(exampleEnv));

    // Load local overrides for per-dev check
    const localOverridePath = getLocalOverridePath(config);
    const localEnv = await loadEnvFile(localOverridePath);

    // Collect keys that are local-only overrides (not secrets or vars)
    const localOnlyKeys = new Set([
      ...(config.raw.local?.overrides ?? []),
      ...Object.values(config.raw.local?.perApp ?? {}).flat(),
    ]);

    consola.log("\nChecking against .env.example...");

    const results: ValidationResult[] = [];
    let hasIssues = false;

    for (const environment of environments) {
      consola.log(`\n  ${environment}`);

      for (const app of apps) {
        const resolved = await resolveAppEnv(config, app, environment);
        const resolvedKeys = new Set(Object.keys(resolved.map));

        // Filter example keys to only those relevant to this app
        // For non-local environments, exclude local-only override keys
        const appExampleKeys = [...exampleKeys].filter((k) => {
          if (!app.allKeys.includes(k)) return false;
          if (environment !== "local" && localOnlyKeys.has(k)) {
            const isSecretOrVar = (app.secrets ?? []).includes(k) || (app.vars ?? []).includes(k);
            if (!isSecretOrVar) return false;
          }
          return true;
        });

        const missingKeys = appExampleKeys.filter((k) => !resolvedKeys.has(k));
        const extraKeys = [...resolvedKeys].filter(
          (k) => !exampleKeys.has(k),
        );

        // Check per-dev overrides (local only)
        const missingOverrides =
          environment === "local"
            ? findMissingOverrides(config, app, localEnv)
            : [];

        const valid = missingKeys.length === 0 && missingOverrides.length === 0;

        results.push({
          app: app.name,
          environment,
          missingKeys,
          extraKeys,
          missingOverrides,
          valid,
        });

        if (!valid) hasIssues = true;

        const keyCount = Object.keys(resolved.map).length;
        const statusIcon = valid ? "\u2714" : "\u2718";

        if (missingKeys.length > 0) {
          consola.log(
            `  ${statusIcon} ${app.name}: ${keyCount}/${appExampleKeys.length} keys`,
          );
          for (const key of missingKeys) {
            consola.log(`    missing: ${key}`);
          }
        } else {
          consola.log(
            `  ${statusIcon} ${app.name}: all ${appExampleKeys.length} keys present`,
          );
        }

        if (missingOverrides.length > 0) {
          consola.warn(
            `    Per-dev overrides missing: ${missingOverrides.join(", ")}`,
          );
        }
      }
    }

    consola.log("");
    if (hasIssues) {
      const issueCount = results.filter((r) => !r.valid).length;
      consola.warn(`${issueCount} environment(s) have issues`);
      process.exit(1);
    } else {
      consola.success("All environments valid!");
    }
  },
});
