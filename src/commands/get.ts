import { defineCommand } from "citty";
import { consola } from "consola";
import { getRootEnvPath, parsePlainEnv } from "../core/env-file.ts";
import { fileExists, readFile } from "../utils/fs.ts";
import { findPassword, decryptValue, isEnvsyncEncrypted } from "../core/encryption.ts";
import { loadResolvedConfig } from "../utils/command.ts";

export default defineCommand({
  meta: {
    name: "get",
    description: "Read an environment variable value from a .env file",
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
    raw: {
      type: "boolean",
      description: "Print the raw stored value without decrypting",
      default: false,
    },
  },
  async run({ args }) {
    const environment = args.env as string;
    const key = args.key as string;

    const config = await loadResolvedConfig(environment);

    const envFilePath = getRootEnvPath(config, environment);

    if (!fileExists(envFilePath)) {
      consola.error(`File not found: ${envFilePath}`);
      process.exit(1);
    }

    const content = await readFile(envFilePath);
    const envMap = parsePlainEnv(content);

    if (!(key in envMap)) {
      consola.error(`Key "${key}" not found in ${envFilePath}`);
      process.exit(1);
    }

    const stored = envMap[key];

    if (args.raw || !isEnvsyncEncrypted(stored)) {
      process.stdout.write(stored + "\n");
      return;
    }

    const password = findPassword(environment, config.projectRoot);
    if (!password) {
      consola.error(
        `Value is encrypted but no password found. Set ENVSYNC_PASSWORD or ENVSYNC_PASSWORD_${environment.toUpperCase()}, or create .env.password. Use --raw to print the ciphertext.`,
      );
      process.exit(1);
    }

    try {
      const plaintext = decryptValue(stored, password);
      process.stdout.write(plaintext + "\n");
    } catch {
      consola.error(
        `Failed to decrypt ${key}: wrong password or corrupted data.`,
      );
      process.exit(1);
    }
  },
});
