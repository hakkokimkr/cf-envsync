import { defineCommand } from "citty";
import { consola } from "consola";
import { resolveApps, getWorkerName } from "../core/config.ts";
import { resolveAppEnv } from "../core/resolver.ts";
import { checkWrangler, listSecrets } from "../core/wrangler.ts";
import { printDiff, maskValue } from "../utils/output.ts";
import type { DiffEntry, EnvDiffEntry } from "../types/env.ts";
import { parseAppNames } from "../utils/args.ts";
import { loadResolvedConfig } from "../utils/command.ts";

export default defineCommand({
  meta: {
    name: "diff",
    description: "Compare local env vars with remote secrets, or between two environments",
  },
  args: {
    env: {
      type: "positional",
      description: "First environment",
      required: true,
    },
    target: {
      type: "positional",
      description: "Second environment (env-vs-env mode) or app name (local-vs-remote mode)",
      required: false,
    },
  },
  async run({ args }) {
    const env1 = args.env as string;
    const config = await loadResolvedConfig(env1);

    // Determine mode: env-vs-env or local-vs-remote
    const target = args.target as string | undefined;
    const isEnv = target && config.environments.includes(target);
    const isApp = target && target in config.apps;

    // Detect ambiguity: target matches both an environment name and an app name
    if (isEnv && isApp) {
      consola.error(
        `"${target}" is both an environment and an app name. This is ambiguous.`,
      );
      consola.info(
        `  To compare environments: envsync diff ${env1} ${target} --\n` +
        `  To diff local vs remote: envsync diff ${env1} -- ${target}`,
      );
      process.exit(1);
    }

    if (isEnv) {
      // --- Env-vs-Env mode ---
      const env2 = target;
      const appNames = parseAppNames(args as unknown as { _?: string[] }, 2);
      const apps = resolveApps(config, appNames);

      consola.info(`Comparing ${env1} vs ${env2}\n`);

      for (const app of apps) {
        const [resolved1, resolved2] = await Promise.all([
          resolveAppEnv(config, app, env1),
          resolveAppEnv(config, app, env2),
        ]);

        const allKeys = new Set([
          ...Object.keys(resolved1.map),
          ...Object.keys(resolved2.map),
        ]);

        const entries: EnvDiffEntry[] = [];
        for (const key of [...allKeys].sort()) {
          const v1 = resolved1.map[key];
          const v2 = resolved2.map[key];

          if (v1 !== undefined && v2 === undefined) {
            entries.push({ key, status: "missing-right", leftValue: v1 });
          } else if (v1 === undefined && v2 !== undefined) {
            entries.push({ key, status: "missing-left", rightValue: v2 });
          } else if (v1 === v2) {
            entries.push({ key, status: "match", leftValue: v1, rightValue: v2 });
          } else {
            entries.push({ key, status: "differs", leftValue: v1, rightValue: v2 });
          }
        }

        consola.log(`  ${app.name}`);
        for (const entry of entries) {
          const icon =
            entry.status === "match" ? "\u2714" :
            entry.status === "differs" ? "\u2714" :
            "\u2718";
          const label =
            entry.status === "match" ? "same" :
            entry.status === "differs" ? "expected" :
            entry.status === "missing-right" ? `missing in ${env2}!` :
            `missing in ${env1}!`;

          consola.log(
            `    ${entry.key.padEnd(24)} ${maskValue(entry.leftValue, "(missing)").padEnd(20)} ${maskValue(entry.rightValue, "(missing)").padEnd(20)} ${icon} ${label}`,
          );
        }

        const issues = entries.filter(
          (e) => e.status === "missing-left" || e.status === "missing-right",
        );
        if (issues.length > 0) {
          consola.warn(`    ${issues.length} key(s) missing`);
        }
        consola.log("");
      }
    } else {
      // --- Local-vs-Remote mode ---
      const hasWrangler = await checkWrangler();
      if (!hasWrangler) {
        consola.error("wrangler CLI not found. Install it with: npm i -D wrangler");
        process.exit(1);
      }

      // target might be an app name, rest args after that are more app names
      const appNames = target
        ? [target, ...(parseAppNames(args as unknown as { _?: string[] }, 2) ?? [])]
        : parseAppNames(args as unknown as { _?: string[] }, 1);
      const apps = resolveApps(config, appNames);

      for (const app of apps) {
        const workerName = getWorkerName(app, env1);
        if (!workerName) {
          consola.warn(`  No worker defined for ${app.name} in ${env1}. Skipping.`);
          continue;
        }

        consola.start(`Diffing ${app.name}: .env vs ${workerName} (${env1})...`);

        const [resolved, remoteKeys] = await Promise.all([
          resolveAppEnv(config, app, env1),
          listSecrets(workerName, env1, app.absolutePath),
        ]);

        const localKeys = new Set(Object.keys(resolved.map));
        const remoteKeySet = new Set(remoteKeys);
        const allKeys = new Set([...localKeys, ...remoteKeySet]);

        const entries: DiffEntry[] = [];
        for (const key of [...allKeys].sort()) {
          const inLocal = localKeys.has(key);
          const inRemote = remoteKeySet.has(key);

          if (inLocal && !inRemote) {
            entries.push({ key, status: "added", localValue: resolved.map[key] });
          } else if (!inLocal && inRemote) {
            entries.push({ key, status: "removed" });
          } else {
            entries.push({ key, status: "unchanged" });
          }
        }

        const added = entries.filter((e) => e.status === "added").length;
        const removed = entries.filter((e) => e.status === "removed").length;

        consola.info(
          `  ${app.name}: ${added} local-only, ${removed} remote-only, ${entries.length - added - removed} shared`,
        );

        const changes = entries.filter((e) => e.status !== "unchanged");
        if (changes.length > 0) {
          printDiff(changes);
          consola.info(`  \u2192 Run \`envsync push ${env1} ${app.name}\` to sync`);
        } else {
          consola.success(`  Keys are in sync.`);
        }
        consola.log("");
      }
    }
  },
});
