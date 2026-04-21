import { defineCommand } from "citty";
import { consola } from "consola";
import { getRootEnvPath, parsePlainEnv, writeEnvFile } from "../core/env-file.ts";
import { fileExists, readFile } from "../utils/fs.ts";
import { findPassword, encryptValue, decryptValue, isEnvsyncEncrypted } from "../core/encryption.ts";
import { loadResolvedConfig } from "../utils/command.ts";

export default defineCommand({
  meta: {
    name: "set",
    description: "Set an environment variable in a .env file",
  },
  args: {
    env: {
      type: "positional",
      description: "Target environment (e.g. staging, production)",
      required: true,
    },
    key: {
      type: "positional",
      description: "Variable name",
      required: true,
    },
    value: {
      type: "positional",
      description: "Variable value",
      required: true,
    },
    raw: {
      type: "boolean",
      description: "Store value as-is without encrypting",
      default: false,
    },
  },
  async run({ args }) {
    const environment = args.env as string;
    const key = args.key as string;
    const value = args.value as string;

    const config = await loadResolvedConfig(environment);

    const envFilePath = getRootEnvPath(config, environment);

    // Load existing env map (raw — no decryption)
    let envMap: Record<string, string> = {};
    if (fileExists(envFilePath)) {
      const content = await readFile(envFilePath);
      envMap = parsePlainEnv(content);
    }

    const isUpdate = key in envMap;

    // Determine final value
    let finalValue = value;
    if (!args.raw && config.raw.encryption === "password") {
      const password = findPassword(environment, config.projectRoot);
      if (!password) {
        consola.error(
          `No password found. Set ENVSYNC_PASSWORD or ENVSYNC_PASSWORD_${environment.toUpperCase()}, or create .env.password`,
        );
        process.exit(1);
      }

      // Verify password against existing encrypted values
      const firstEncrypted = Object.entries(envMap).find(
        ([, v]) => isEnvsyncEncrypted(v),
      );
      if (firstEncrypted) {
        try {
          decryptValue(firstEncrypted[1], password);
        } catch {
          consola.error(
            `Password mismatch: cannot decrypt existing value for ${firstEncrypted[0]}. ` +
            `The current password differs from the one used to encrypt existing values.`,
          );
          process.exit(1);
        }
      }

      finalValue = encryptValue(value, password);
    }

    envMap[key] = finalValue;

    await writeEnvFile(envFilePath, envMap);

    const action = isUpdate ? "Updated" : "Added";
    const encrypted = !args.raw && config.raw.encryption === "password" ? " (encrypted)" : "";
    consola.success(`${action} ${key} in ${envFilePath}${encrypted}`);
  },
});
