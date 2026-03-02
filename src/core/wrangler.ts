import { join } from "node:path";
import { consola } from "consola";
import { exec } from "../utils/process.ts";
import { fileExists, readFile, writeFile } from "../utils/fs.ts";
import type { EnvMap } from "../types/env.ts";

/**
 * Strip JSONC comments (// and /* *​/) and trailing commas.
 * Respects string literals so quoted slashes aren't stripped.
 */
function stripJsonc(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;

  while (i < text.length) {
    if (inString) {
      result += text[i];
      if (text[i] === "\\" && i + 1 < text.length) {
        result += text[i + 1];
        i += 2;
        continue;
      }
      if (text[i] === '"') inString = false;
      i++;
      continue;
    }

    if (text[i] === '"') {
      inString = true;
      result += text[i];
      i++;
      continue;
    }

    // Line comment
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }

    // Block comment
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    result += text[i];
    i++;
  }

  // Remove trailing commas before } or ]
  return result.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Check if wrangler CLI is available.
 */
export async function checkWrangler(): Promise<boolean> {
  const result = await exec(["npx", "wrangler", "--version"]);
  return result.success;
}

/**
 * Push secrets to a Cloudflare Worker via `wrangler secret bulk`.
 * Pipes JSON to stdin.
 *
 * Uses `--name` to specify the worker directly — no `--env` flag needed
 * since the worker name already encodes the environment.
 */
export async function pushSecrets(
  workerName: string,
  secrets: EnvMap,
  environment: string,
  cwd?: string,
): Promise<{ success: boolean; output: string }> {
  const json = JSON.stringify(secrets);
  const args = [
    "npx",
    "wrangler",
    "secret",
    "bulk",
    "--name",
    workerName,
  ];

  consola.debug(`Running: ${args.join(" ")}`);
  const result = await exec(args, { cwd, stdin: json });

  if (!result.success) {
    consola.error(`Failed to push secrets to ${workerName}:`, result.stderr);
  }

  return {
    success: result.success,
    output: result.success ? result.stdout : result.stderr,
  };
}

/**
 * List secrets for a Cloudflare Worker via `wrangler secret list`.
 * Returns only key names (values are not available via API).
 */
export async function listSecrets(
  workerName: string,
  _environment: string,
  cwd?: string,
): Promise<string[]> {
  const args = [
    "npx",
    "wrangler",
    "secret",
    "list",
    "--name",
    workerName,
  ];

  const result = await exec(args, { cwd });

  if (!result.success) {
    consola.error(
      `Failed to list secrets for ${workerName}:`,
      result.stderr,
    );
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout) as { name: string; type: string }[];
    return parsed.map((s) => s.name);
  } catch {
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}

/**
 * Delete a single secret from a Cloudflare Worker.
 */
export async function deleteSecret(
  workerName: string,
  key: string,
  _environment: string,
  cwd?: string,
): Promise<boolean> {
  const args = [
    "npx",
    "wrangler",
    "secret",
    "delete",
    key,
    "--name",
    workerName,
    "--force",
  ];

  const result = await exec(args, { cwd });
  return result.success;
}

/**
 * Find the wrangler config file in an app directory.
 */
function findWranglerConfig(appPath: string): string | undefined {
  for (const name of ["wrangler.jsonc", "wrangler.json"]) {
    const p = join(appPath, name);
    if (fileExists(p)) return p;
  }
  return undefined;
}

/**
 * Update the `vars` section in an app's wrangler.jsonc/wrangler.json.
 * Merges with existing vars (envsync-managed keys are added/updated,
 * manually set keys are preserved).
 */
export async function updateWranglerVars(
  appPath: string,
  vars: EnvMap,
): Promise<{ success: boolean; filePath?: string; updatedCount: number }> {
  const configPath = findWranglerConfig(appPath);
  if (!configPath) {
    return { success: false, updatedCount: 0 };
  }

  const content = await readFile(configPath);
  const stripped = stripJsonc(content);
  const config = JSON.parse(stripped) as Record<string, unknown>;

  config.vars = { ...((config.vars as Record<string, string>) || {}), ...vars };

  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");

  return { success: true, filePath: configPath, updatedCount: Object.keys(vars).length };
}
