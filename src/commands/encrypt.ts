import { defineCommand } from "citty";
import { consola } from "consola";
import { loadConfig, validateConfig, resolveConfig } from "../core/config.ts";
import { getRootEnvPath } from "../core/env-file.ts";
import { fileExists, readFile, writeFile } from "../utils/fs.ts";
import { findPassword, encryptValue, decryptValue, isEnvsyncEncrypted } from "../core/encryption.ts";

/**
 * Parse plain KEY=VALUE content preserving structure.
 */
function parseLines(content: string): { key?: string; value?: string; raw: string }[] {
  return content.split("\n").map((line) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      return { raw: line };
    }
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      return { raw: line };
    }
    return {
      key: line.slice(0, eqIdx).trim(),
      value: line.slice(eqIdx + 1),
      raw: line,
    };
  });
}

export default defineCommand({
  meta: {
    name: "encrypt",
    description: "Encrypt plain .env values with password encryption",
  },
  args: {
    env: {
      type: "positional",
      description: "Target environment (e.g. staging, production)",
      required: true,
    },
    "dry-run": {
      type: "boolean",
      description: "Preview changes without writing",
      default: false,
    },
  },
  async run({ args }) {
    const environment = args.env as string;

    const rawConfig = await loadConfig();
    const errors = validateConfig(rawConfig);
    if (errors.length > 0) {
      for (const err of errors) consola.error(err);
      process.exit(1);
    }

    const config = resolveConfig(rawConfig);

    if (config.raw.encryption !== "password") {
      consola.error('encrypt command requires encryption: "password" in config.');
      process.exit(1);
    }

    if (!config.environments.includes(environment)) {
      consola.error(
        `Unknown environment: "${environment}". Available: ${config.environments.join(", ")}`,
      );
      process.exit(1);
    }

    const password = findPassword(environment, config.projectRoot);
    if (!password) {
      consola.error(
        `No password found. Set ENVSYNC_PASSWORD or ENVSYNC_PASSWORD_${environment.toUpperCase()}, or create .env.password`,
      );
      process.exit(1);
    }

    const envFilePath = getRootEnvPath(config, environment);
    if (!fileExists(envFilePath)) {
      consola.error(`File not found: ${envFilePath}`);
      process.exit(1);
    }

    const content = await readFile(envFilePath);
    const lines = parseLines(content);

    // Verify current password against existing encrypted values
    const firstEncrypted = lines.find(
      (l) => l.key && l.value && isEnvsyncEncrypted(l.value.trim()),
    );
    if (firstEncrypted) {
      try {
        decryptValue(firstEncrypted.value!.trim(), password);
      } catch {
        consola.error(
          `Password mismatch: cannot decrypt existing value for ${firstEncrypted.key}. ` +
          `The current password differs from the one used to encrypt existing values.`,
        );
        process.exit(1);
      }
    }

    let encryptedCount = 0;
    let skippedCount = 0;
    const outputLines: string[] = [];

    for (const line of lines) {
      if (!line.key || line.value === undefined) {
        outputLines.push(line.raw);
        continue;
      }

      const value = line.value.trim();

      // Skip already encrypted or empty values
      if (isEnvsyncEncrypted(value) || value === "") {
        outputLines.push(line.raw);
        skippedCount++;
        continue;
      }

      // Strip quotes for encryption
      let plainValue = value;
      if ((plainValue.startsWith('"') && plainValue.endsWith('"')) || (plainValue.startsWith("'") && plainValue.endsWith("'"))) {
        plainValue = plainValue.slice(1, -1);
      }

      const encrypted = encryptValue(plainValue, password);
      outputLines.push(`${line.key}=${encrypted}`);
      encryptedCount++;
      consola.log(`  ${line.key}: encrypted`);
    }

    if (encryptedCount === 0) {
      consola.info("No values to encrypt.");
      return;
    }

    const dryRun = args["dry-run"] as boolean;
    if (dryRun) {
      consola.info(`[dry-run] Would encrypt ${encryptedCount} values in ${envFilePath}`);
      return;
    }

    await writeFile(envFilePath, outputLines.join("\n") + "\n");
    consola.success(`Encrypted ${encryptedCount} values in ${envFilePath} (${skippedCount} skipped)`);
  },
});
