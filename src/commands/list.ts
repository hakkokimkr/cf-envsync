import { defineCommand } from "citty";
import { consola } from "consola";
import { loadConfig, validateConfig, resolveConfig, resolveApps, getWorkerName } from "../core/config.ts";
import { resolveAppEnv } from "../core/resolver.ts";
import { getRootEnvPath, loadEnvFile, getLocalOverridePath } from "../core/env-file.ts";
import { fileExists } from "../utils/fs.ts";
import { printTree } from "../utils/output.ts";

export default defineCommand({
  meta: {
    name: "list",
    description: "List apps and their env var keys per environment",
  },
  args: {
    app: {
      type: "positional",
      description: "Specific app name to inspect",
      required: false,
    },
    keys: {
      type: "boolean",
      description: "Show individual key names",
      default: false,
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
    const appNames = args.app ? [args.app as string] : undefined;
    const apps = resolveApps(config, appNames);

    if (apps.length === 0) {
      consola.warn("No apps found.");
      return;
    }

    const environments = config.environments;

    if (args.keys) {
      // Detailed view with key names
      for (const app of apps) {
        const treeItems: { label: string; children: string[] }[] = [];

        for (const env of environments) {
          const workerName = getWorkerName(app, env);
          const resolved = await resolveAppEnv(config, app, env);
          const keys = Object.keys(resolved.map).sort();
          const workerLabel = workerName ? ` \u2192 ${workerName}` : " (dev)";
          treeItems.push({
            label: `${env}${workerLabel} (${keys.length} keys)`,
            children: keys,
          });
        }

        printTree(`${app.name} (path: ${app.path})`, treeItems);
      }
    } else {
      // Summary table matching plan format
      // Build column widths
      const colData: { app: string; cells: { worker: string; detail: string }[] }[] = [];

      for (const app of apps) {
        const cells: { worker: string; detail: string }[] = [];
        for (const env of environments) {
          const workerName = getWorkerName(app, env);
          const resolved = await resolveAppEnv(config, app, env);
          const secretCount = (app.secrets ?? []).filter((k) => k in resolved.map).length;
          const varCount = (app.vars ?? []).filter((k) => k in resolved.map).length;

          const worker = workerName ?? "(dev)";
          const parts: string[] = [];
          if (secretCount > 0) parts.push(`${secretCount} secret${secretCount > 1 ? "s" : ""}`);
          if (varCount > 0) parts.push(`${varCount} var${varCount > 1 ? "s" : ""}`);
          const detail = parts.join(", ") || "0 keys";

          cells.push({ worker, detail });
        }
        colData.push({ app: app.name, cells });
      }

      // Calculate column widths
      const appColW = Math.max(3, ...colData.map((d) => d.name?.length ?? d.app.length));
      const envColWidths = environments.map((env, i) =>
        Math.max(
          env.length,
          ...colData.map((d) => Math.max(d.cells[i]!.worker.length, d.cells[i]!.detail.length)),
        ),
      );

      // Header
      const header = `  ${"App".padEnd(appColW)}  ${environments.map((e, i) => e.padEnd(envColWidths[i]!)).join("  ")}`;
      const sep = `  ${"─".repeat(appColW)}  ${envColWidths.map((w) => "─".repeat(w)).join("  ")}`;
      consola.log(header);
      consola.log(sep);

      // Rows (2 lines per app: worker name + key counts)
      for (const data of colData) {
        const workerLine = `  ${data.app.padEnd(appColW)}  ${data.cells.map((c, i) => c.worker.padEnd(envColWidths[i]!)).join("  ")}`;
        const detailLine = `  ${"".padEnd(appColW)}  ${data.cells.map((c, i) => c.detail.padEnd(envColWidths[i]!)).join("  ")}`;
        consola.log(workerLine);
        consola.log(detailLine);
        consola.log("");
      }
    }

    // Shared secrets
    const shared = config.raw.shared ?? [];
    if (shared.length > 0) {
      consola.log(`  Shared secrets (${shared.length}): ${shared.join(", ")}`);
    }

    // Per-dev overrides
    const overrides = [
      ...(config.raw.local?.overrides ?? []),
      ...Object.values(config.raw.local?.perApp ?? {}).flat(),
    ];
    if (overrides.length > 0) {
      consola.log(
        `  Per-dev overrides (local only): ${[...new Set(overrides)].join(", ")}`,
      );
    }

    // .env file status
    consola.log("\n  .env files status:");
    const envPaths: { path: string; exists: boolean; label: string }[] = [];
    for (const env of environments) {
      const envPath = getRootEnvPath(config, env);
      envPaths.push({
        path: envPath,
        exists: fileExists(envPath),
        label: envPath.replace(config.projectRoot + "/", ""),
      });
    }
    const localPath = getLocalOverridePath(config);
    envPaths.push({
      path: localPath,
      exists: fileExists(localPath),
      label: localPath.replace(config.projectRoot + "/", ""),
    });

    for (let i = 0; i < envPaths.length; i++) {
      const ep = envPaths[i]!;
      const isLast = i === envPaths.length - 1;
      const prefix = isLast ? "\u2514" : "\u251C";
      if (ep.exists) {
        const envMap = await loadEnvFile(ep.path);
        const keyCount = Object.keys(envMap).length;
        const isLocal = ep.path === localPath;
        const countLabel = isLocal ? `${keyCount} overrides` : `${keyCount} keys`;
        consola.log(`  ${prefix} ${ep.label} \u2714 (${countLabel})`);
      } else {
        consola.log(`  ${prefix} ${ep.label} \u2718 missing`);
      }
    }
    consola.log("");
  },
});
