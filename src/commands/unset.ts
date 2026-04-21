import { defineCommand } from "citty";
import { consola } from "consola";
import { getRootEnvPath, parsePlainEnv, writeEnvFile } from "../core/env-file.ts";
import { fileExists, readFile } from "../utils/fs.ts";
import { loadResolvedConfig } from "../utils/command.ts";

export default defineCommand({
  meta: {
    name: "unset",
    description: "Remove an environment variable from a .env file",
  },
  args: {
    env: {
      type: "positional",
      description: "Target environment (e.g. staging, production)",
      required: true,
    },
    key: {
      type: "positional",
      description: "Variable name to remove",
      required: true,
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
      consola.warn(`Key "${key}" not found in ${envFilePath}`);
      return;
    }

    delete envMap[key];

    await writeEnvFile(envFilePath, envMap);
    consola.success(`Removed ${key} from ${envFilePath}`);
  },
});
