import { consola } from "consola";
import { exec } from "../utils/process.ts";
import type { EnvMap } from "../types/env.ts";

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
