import { defineCommand } from "citty";
import { join, relative, basename } from "node:path";
import { consola } from "consola";
import { fileExists, readFile, writeFile, globFiles, CONFIG_FILES } from "../utils/fs.ts";
import type { EnvSyncConfig, AppConfig } from "../types/config.ts";

interface WranglerEnvConfig {
  name?: string;
}

interface WranglerConfig {
  name?: string;
  env?: Record<string, WranglerEnvConfig>;
}

/**
 * Generate a typed envsync.config.ts file content from config object.
 */
function generateConfigTS(config: EnvSyncConfig): string {
  const lines: string[] = [
    `import { defineConfig } from "cf-envsync";`,
    ``,
    `export default defineConfig({`,
  ];

  // environments
  lines.push(`  environments: ${JSON.stringify(config.environments)},`);
  lines.push(``);

  // envFiles
  lines.push(`  envFiles: {`);
  lines.push(`    pattern: ${JSON.stringify(config.envFiles.pattern)},`);
  lines.push(`    local: ${JSON.stringify(config.envFiles.local)},`);
  lines.push(`    perApp: ${config.envFiles.perApp},`);
  lines.push(`  },`);
  lines.push(``);

  // encryption
  lines.push(`  encryption: ${JSON.stringify(config.encryption)},`);
  lines.push(``);

  // apps
  lines.push(`  apps: {`);
  for (const [name, app] of Object.entries(config.apps)) {
    lines.push(`    ${quoteKey(name)}: {`);
    lines.push(`      path: ${JSON.stringify(app.path)},`);
    lines.push(`      workers: {`);
    for (const [env, worker] of Object.entries(app.workers)) {
      lines.push(`        ${quoteKey(env)}: ${JSON.stringify(worker)},`);
    }
    lines.push(`      },`);
    if (app.secrets?.length) {
      lines.push(`      secrets: ${JSON.stringify(app.secrets)},`);
    }
    if (app.vars?.length) {
      lines.push(`      vars: ${JSON.stringify(app.vars)},`);
    }
    lines.push(`    },`);
  }
  lines.push(`  },`);

  // shared
  if (config.shared?.length) {
    lines.push(``);
    lines.push(`  shared: ${JSON.stringify(config.shared)},`);
  }

  // local
  if (config.local) {
    lines.push(``);
    lines.push(`  local: {`);
    if (config.local.overrides?.length) {
      lines.push(`    overrides: ${JSON.stringify(config.local.overrides)},`);
    }
    if (config.local.perApp && Object.keys(config.local.perApp).length > 0) {
      lines.push(`    perApp: {`);
      for (const [appName, keys] of Object.entries(config.local.perApp)) {
        lines.push(`      ${quoteKey(appName)}: ${JSON.stringify(keys)},`);
      }
      lines.push(`    },`);
    }
    lines.push(`  },`);
  }

  lines.push(`});`);
  lines.push(``);
  return lines.join("\n");
}

/** Quote an object key only if it's not a valid identifier. */
function quoteKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

export default defineCommand({
  meta: {
    name: "init",
    description: "Initialize envsync configuration",
  },
  args: {
    monorepo: {
      type: "boolean",
      description: "Scan for wrangler configs in subdirectories",
      default: false,
    },
  },
  async run({ args }) {
    const cwd = process.cwd();

    // Check if any config file already exists
    const existingConfig = CONFIG_FILES.find((f) => fileExists(join(cwd, f)));
    if (existingConfig) {
      consola.warn(`${existingConfig} already exists.`);
      const overwrite = await consola.prompt("Overwrite?", {
        type: "confirm",
      });
      if (!overwrite) {
        consola.info("Aborted.");
        return;
      }
    }

    // Choose encryption
    const encryption = (await consola.prompt("Encryption method:", {
      type: "select",
      options: ["password", "dotenvx", "none"],
    })) as "dotenvx" | "password" | "none";

    // Environments
    const defaultEnvs = "local, staging, production";
    const envsInput = (await consola.prompt("Environments (comma-separated):", {
      type: "text",
      default: defaultEnvs,
    })) as string;
    const environments = envsInput.split(",").map((s) => s.trim()).filter(Boolean);

    const apps: Record<string, AppConfig> = {};
    const allSecretKeys: Map<string, string[]> = new Map(); // key -> app names

    if (args.monorepo) {
      // Scan for wrangler.jsonc / wrangler.json files
      consola.start("Scanning for wrangler config files...");

      const wranglerFiles = await globFiles(cwd, (f) => {
        const name = basename(f);
        return (
          (name === "wrangler.json" || name === "wrangler.jsonc") &&
          !f.includes("node_modules")
        );
      });

      if (wranglerFiles.length === 0) {
        consola.warn("No wrangler config files found. Creating manually.");
      }

      for (const wranglerFile of wranglerFiles.sort()) {
        const fullPath = join(cwd, wranglerFile);
        const appDir = join(cwd, wranglerFile, "..");
        const appPath = relative(cwd, appDir);
        const appName = basename(appDir);

        consola.info(`  Found ${wranglerFile}`);

        let wranglerConfig: WranglerConfig = {};
        try {
          let content = await readFile(fullPath);
          // Strip JSONC comments
          content = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
          wranglerConfig = JSON.parse(content);
        } catch {
          consola.warn(`    Could not parse ${wranglerFile}. Skipping.`);
          continue;
        }

        // Extract worker names per environment
        const workers: Record<string, string> = {};
        if (wranglerConfig.name) {
          workers.production = wranglerConfig.name;
          consola.log(`    production \u2192 ${wranglerConfig.name}`);
        }
        for (const [envName, envConfig] of Object.entries(wranglerConfig.env ?? {})) {
          const workerName = envConfig.name ?? `${wranglerConfig.name}-${envName}`;
          workers[envName] = workerName;
          consola.log(`    ${envName} \u2192 ${workerName}`);
        }

        // Ask for secrets
        const secretsInput = (await consola.prompt(
          `  Secrets for ${appName} (comma-separated, or empty):`,
          { type: "text", default: "" },
        )) as string;
        const secrets = secretsInput.split(",").map((s) => s.trim()).filter(Boolean);

        // Track which apps use which keys for shared detection
        for (const key of secrets) {
          if (!allSecretKeys.has(key)) allSecretKeys.set(key, []);
          allSecretKeys.get(key)!.push(appName);
        }

        const varsInput = (await consola.prompt(
          `  Vars for ${appName} (comma-separated, or empty):`,
          { type: "text", default: "" },
        )) as string;
        const vars = varsInput.split(",").map((s) => s.trim()).filter(Boolean);

        apps[appName] = {
          path: appPath === "." ? "." : appPath,
          workers,
          ...(secrets.length > 0 ? { secrets } : {}),
          ...(vars.length > 0 ? { vars } : {}),
        };
      }

      // If no wrangler files found, ask manually
      if (wranglerFiles.length === 0) {
        const appName = (await consola.prompt("App name:", {
          type: "text",
          default: "api",
        })) as string;

        const appPath = (await consola.prompt("App path:", {
          type: "text",
          default: `apps/${appName}`,
        })) as string;

        const workerName = (await consola.prompt("Worker name (production):", {
          type: "text",
          default: appName,
        })) as string;

        apps[appName] = {
          path: appPath,
          workers: { production: workerName },
        };
      }
    } else {
      // Single-app mode
      const workerName = (await consola.prompt("Worker name:", {
        type: "text",
        default: "my-worker",
      })) as string;

      const secretsInput = (await consola.prompt(
        "Secrets (comma-separated, or empty):",
        { type: "text", default: "" },
      )) as string;
      const secrets = secretsInput.split(",").map((s) => s.trim()).filter(Boolean);

      const varsInput = (await consola.prompt(
        "Vars (comma-separated, or empty):",
        { type: "text", default: "" },
      )) as string;
      const vars = varsInput.split(",").map((s) => s.trim()).filter(Boolean);

      // Build workers map from environments (skip local)
      const workers: Record<string, string> = {};
      for (const env of environments) {
        if (env === "local") continue;
        if (env === "production") {
          workers[env] = workerName;
        } else {
          workers[env] = `${workerName}-${env}`;
        }
      }

      apps.default = {
        path: ".",
        workers,
        ...(secrets.length > 0 ? { secrets } : {}),
        ...(vars.length > 0 ? { vars } : {}),
      };
    }

    // Detect shared secrets
    const shared: string[] = [];
    for (const [key, appNames] of allSecretKeys) {
      if (appNames.length > 1) {
        shared.push(key);
        consola.info(`  Shared secret: ${key} \u2192 ${appNames.join(", ")}`);
      }
    }

    const config: EnvSyncConfig = {
      environments,
      envFiles: {
        pattern: ".env.{env}",
        local: ".env.local",
        perApp: args.monorepo,
      },
      encryption,
      apps,
      ...(shared.length > 0 ? { shared } : {}),
    };

    // Generate envsync.config.ts with defineConfig
    const configPath = join(cwd, "envsync.config.ts");
    const tsContent = generateConfigTS(config);

    // Remove old config file if overwriting a different format
    if (existingConfig && existingConfig !== "envsync.config.ts") {
      const oldPath = join(cwd, existingConfig);
      if (fileExists(oldPath)) {
        const { unlink } = await import("node:fs/promises");
        await unlink(oldPath);
      }
    }

    await writeFile(configPath, tsContent);
    consola.success("Created envsync.config.ts");

    // Create .env.example
    const examplePath = join(cwd, ".env.example");
    if (!fileExists(examplePath)) {
      const allKeys = new Set<string>();
      for (const app of Object.values(apps)) {
        for (const k of app.secrets ?? []) allKeys.add(k);
        for (const k of app.vars ?? []) allKeys.add(k);
      }
      const exampleContent = [
        "# Environment variables for this project",
        "# See envsync.config.ts for per-app key mapping",
        "",
        ...[...allKeys].sort().map((k) => `${k}=`),
        "",
      ].join("\n");
      await writeFile(examplePath, exampleContent);
      consola.success(`Created .env.example`);
    }

    // Create empty env files
    for (const env of environments) {
      if (env === "local") continue;
      const envFile = join(cwd, `.env.${env}`);
      if (!fileExists(envFile)) {
        await writeFile(envFile, `# ${env} environment variables\n`);
        consola.success(`Created .env.${env}`);
      }
    }
    const rootEnv = join(cwd, ".env");
    if (!fileExists(rootEnv)) {
      await writeFile(rootEnv, "# Local environment variables\n");
      consola.success("Created .env");
    }

    // Update .gitignore
    const gitignorePath = join(cwd, ".gitignore");
    const gitignoreEntries = [".env.local", ".env.keys", ".env.password", "**/.dev.vars"];
    if (fileExists(gitignorePath)) {
      const existing = await readFile(gitignorePath);
      const toAdd = gitignoreEntries.filter((e) => !existing.includes(e));
      if (toAdd.length > 0) {
        await writeFile(
          gitignorePath,
          existing.trimEnd() + "\n\n# envsync\n" + toAdd.join("\n") + "\n",
        );
        consola.success(`Updated .gitignore`);
      }
    } else {
      await writeFile(
        gitignorePath,
        "# envsync\n" + gitignoreEntries.join("\n") + "\n",
      );
      consola.success(`Created .gitignore`);
    }

    // Register Git merge driver
    const gitattrsPath = join(cwd, ".gitattributes");
    const mergeDriverLines = ".env merge=envsync\n.env.* merge=envsync\n";
    if (fileExists(gitattrsPath)) {
      const existing = await readFile(gitattrsPath);
      if (!existing.includes("merge=envsync")) {
        await writeFile(gitattrsPath, existing.trimEnd() + "\n\n" + mergeDriverLines);
        consola.success("Updated .gitattributes with merge driver");
      }
    } else {
      await writeFile(gitattrsPath, mergeDriverLines);
      consola.success("Created .gitattributes with merge driver");
    }

    // Register merge driver in git config
    const gitConfigPath = join(cwd, ".git", "config");
    if (fileExists(gitConfigPath)) {
      const gitConfig = await readFile(gitConfigPath);
      if (!gitConfig.includes('[merge "envsync"]')) {
        const mergeConfig = `\n[merge "envsync"]\n\tname = envsync dotenvx merge\n\tdriver = envsync merge %O %A %B\n`;
        await writeFile(gitConfigPath, gitConfig.trimEnd() + mergeConfig);
        consola.success("Registered merge driver in .git/config");
      }
    }

    consola.info("\nNext steps:");
    if (encryption === "password") {
      consola.info('  1. Set a password: echo "ENVSYNC_PASSWORD=your-secret" > .env.password');
      consola.info("  2. Add values to your .env files (plain KEY=VALUE)");
      consola.info("  3. envsync encrypt staging  (encrypts plain values in .env.staging)");
    } else if (encryption === "dotenvx") {
      consola.info('  1. dotenvx set DATABASE_URL "value" -f .env');
      for (const env of environments.filter((e) => e !== "local")) {
        consola.info(`  2. dotenvx set DATABASE_URL "${env}_value" -f .env.${env}`);
      }
    }
    consola.info(`  ${encryption === "password" ? "4" : "3"}. echo "OAUTH_REDIRECT_URL=https://your-tunnel/callback" >> .env.local`);
    consola.info(`  ${encryption === "password" ? "5" : "4"}. envsync dev`);
  },
});
