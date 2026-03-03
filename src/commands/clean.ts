import { defineCommand } from "citty";
import { join, relative } from "node:path";
import { unlinkSync } from "node:fs";
import { consola } from "consola";
import { loadConfig, validateConfig, resolveConfig } from "../core/config.ts";
import { removeWranglerVars } from "../core/wrangler.ts";
import { fileExists } from "../utils/fs.ts";

export default defineCommand({
  meta: {
    name: "clean",
    description: "Remove generated files (.dev.vars, wrangler.jsonc vars)",
  },
  args: {
    "dry-run": {
      type: "boolean",
      description: "Show what would be removed without removing",
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
    const apps = Object.values(config.apps);

    if (apps.length === 0) {
      consola.warn("No apps to process.");
      return;
    }

    const dryRun = args["dry-run"];
    let removedFiles = 0;
    let removedVars = 0;

    for (const app of apps) {
      // Remove devFiles
      for (const devFileName of app.devFiles) {
        const filePath = join(app.absolutePath, devFileName);
        if (!fileExists(filePath)) continue;

        const rel = relative(config.projectRoot, filePath);
        if (dryRun) {
          consola.log(`  Would remove ${rel}`);
        } else {
          unlinkSync(filePath);
          consola.log(`  Removed ${rel}`);
        }
        removedFiles++;
      }

      // Remove wrangler.jsonc vars
      const result = await removeWranglerVars(app.absolutePath, config.environments, dryRun);
      if (result.success && result.removedCount > 0) {
        const rel = relative(config.projectRoot, result.filePath!);
        if (dryRun) {
          consola.log(`  Would remove ${result.removedCount} vars section(s) from ${rel}`);
        } else {
          consola.log(`  Removed ${result.removedCount} vars section(s) from ${rel}`);
        }
        removedVars += result.removedCount;
      }
    }

    if (removedFiles === 0 && removedVars === 0) {
      consola.info("Nothing to clean.");
      return;
    }

    const action = dryRun ? "Would remove" : "Removed";
    const parts: string[] = [];
    if (removedFiles > 0) parts.push(`${removedFiles} file(s)`);
    if (removedVars > 0) parts.push(`${removedVars} vars section(s)`);
    consola.success(`${action} ${parts.join(", ")}.`);
  },
});
