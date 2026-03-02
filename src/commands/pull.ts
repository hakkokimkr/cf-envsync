import { defineCommand } from "citty";
import { consola } from "consola";
import { loadConfig, validateConfig, resolveConfig, resolveApps, getWorkerName } from "../core/config.ts";
import { resolveAppEnv } from "../core/resolver.ts";
import { checkWrangler, listSecrets } from "../core/wrangler.ts";
import { getRootEnvPath, loadEnvFile, writeEnvFile } from "../core/env-file.ts";

function parseAppNames(args: { _?: string[] }, skip = 1): string[] | undefined {
  const rest = args._?.slice(skip);
  return rest?.length ? rest : undefined;
}

export default defineCommand({
  meta: {
    name: "pull",
    description: "Pull remote secret keys and scaffold missing entries locally",
  },
  args: {
    env: {
      type: "positional",
      description: "Target environment (e.g. staging, production)",
      required: true,
    },
  },
  async run({ args }) {
    const environment = args.env as string;

    if (environment === "local") {
      consola.error('Cannot pull from "local".');
      process.exit(1);
    }

    const hasWrangler = await checkWrangler();
    if (!hasWrangler) {
      consola.error("wrangler CLI not found. Install it with: npm i -D wrangler");
      process.exit(1);
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

    for (const app of apps) {
      const workerName = getWorkerName(app, environment);
      if (!workerName) {
        consola.warn(`  No worker defined for ${app.name} in ${environment}. Skipping.`);
        continue;
      }

      consola.start(`Pulling secret keys for ${app.name} from ${workerName} (${environment})...`);

      const remoteKeys = await listSecrets(
        workerName,
        environment,
        app.absolutePath,
      );

      if (remoteKeys.length === 0) {
        consola.warn(`  No secrets found for ${workerName}. Skipping.`);
        continue;
      }

      consola.info(`  Found ${remoteKeys.length} remote keys`);

      // Load existing local env file for this environment
      const envFilePath = getRootEnvPath(config, environment);
      const localEnv = await loadEnvFile(envFilePath, environment, config.projectRoot, config.raw.encryption);
      const localKeys = new Set(Object.keys(localEnv));

      const missingKeys = remoteKeys.filter((k) => !localKeys.has(k));

      if (missingKeys.length === 0) {
        consola.success(`  All remote keys already present locally.`);
        continue;
      }

      consola.info(`  ${missingKeys.length} keys missing locally:`);
      for (const key of missingKeys) {
        consola.log(`    + ${key}`);
        localEnv[key] = "";
      }

      await writeEnvFile(envFilePath, localEnv);
      consola.success(
        `  Scaffolded ${missingKeys.length} keys in ${envFilePath}`,
      );
    }

    consola.success("Done!");
  },
});
