import { existsSync } from "node:fs";
import { readFile as _readFile, writeFile as _writeFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export function fileExists(path: string): boolean {
  return existsSync(path);
}

export async function readFile(path: string): Promise<string> {
  return _readFile(path, "utf-8");
}

export async function writeFile(path: string, content: string): Promise<void> {
  await _writeFile(path, content, "utf-8");
}

/**
 * Recursively find files matching a test function.
 * Cross-runtime alternative to Bun's Glob.
 */
export async function globFiles(
  dir: string,
  test: (relativePath: string) => boolean,
): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries
    .filter((entry) => {
      const name = typeof entry === "string" ? entry : entry.toString();
      return test(name);
    })
    .map((entry) => (typeof entry === "string" ? entry : entry.toString()));
}

/** Config file names in search priority order. */
export const CONFIG_FILES = [
  "envsync.config.ts",
  "envsync.config.js",
  "envsync.config.mjs",
  "envsync.json",
  "envsync.jsonc",
] as const;

export type ConfigFilename = (typeof CONFIG_FILES)[number];

export interface ProjectRoot {
  root: string;
  configFile: ConfigFilename;
}

/**
 * Walk up from `startDir` until we find a config file.
 * Searches for: envsync.config.ts, .js, .mjs, envsync.json, envsync.jsonc
 */
export function findProjectRoot(startDir?: string): ProjectRoot | null {
  let dir = resolve(startDir ?? process.cwd());

  while (true) {
    for (const file of CONFIG_FILES) {
      if (existsSync(join(dir, file))) {
        return { root: dir, configFile: file };
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}
