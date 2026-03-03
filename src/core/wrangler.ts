import { join } from "node:path";
import { consola } from "consola";
import { exec } from "../utils/process.ts";
import { fileExists, readFile, writeFile } from "../utils/fs.ts";
import type { EnvMap } from "../types/env.ts";

/**
 * Strip JSONC comments and trailing commas for parsing.
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
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    result += text[i];
    i++;
  }
  return result.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Find the brace-matched range for a JSON value starting at `start`.
 * Returns the index after the closing brace/bracket.
 */
function findValueEnd(text: string, start: number): number {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : undefined;
  if (!close) {
    // Primitive value — find next , or } or ]
    let i = start;
    if (text[i] === '"') {
      i++;
      while (i < text.length) {
        if (text[i] === "\\" && i + 1 < text.length) { i += 2; continue; }
        if (text[i] === '"') return i + 1;
        i++;
      }
      return i;
    }
    while (i < text.length && text[i] !== "," && text[i] !== "}" && text[i] !== "]") i++;
    return i;
  }
  let depth = 1;
  let i = start + 1;
  let inStr = false;
  while (i < text.length && depth > 0) {
    if (inStr) {
      if (text[i] === "\\" && i + 1 < text.length) { i += 2; continue; }
      if (text[i] === '"') inStr = false;
      i++;
      continue;
    }
    if (text[i] === '"') { inStr = true; i++; continue; }
    // Skip JSONC comments inside the value
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (text[i] === open) depth++;
    if (text[i] === close) depth--;
    i++;
  }
  return i;
}

/**
 * Find the position of a JSON key's value in raw JSONC text.
 * Returns [valueStart, valueEnd] or undefined if key not found.
 */
function findKeyRange(text: string, key: string, searchStart = 0): [number, number] | undefined {
  const needle = `"${key}"`;
  let i = searchStart;
  let inString = false;

  while (i < text.length) {
    if (inString) {
      if (text[i] === "\\" && i + 1 < text.length) { i += 2; continue; }
      if (text[i] === '"') inString = false;
      i++;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (text.startsWith(needle, i)) {
      // Found the key — skip past "key" and whitespace/colon
      let j = i + needle.length;
      while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) j++;
      if (text[j] === ":") {
        j++;
        while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) j++;
        const end = findValueEnd(text, j);
        return [j, end];
      }
    }
    if (text[i] === '"') { inString = true; i++; continue; }
    i++;
  }
  return undefined;
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
 * Detect indentation style from existing JSONC content.
 */
function detectIndent(content: string): string {
  const match = content.match(/\n(\s+)"/);
  return match ? match[1] : "  ";
}

/**
 * Re-indent a JSON.stringify result so that lines 2+ are offset by baseIndent.
 * Line 1 (opening brace) stays inline; subsequent lines get the base prepended.
 */
function reindentJson(json: string, baseIndent: string): string {
  return json.replace(/\n/g, `\n${baseIndent}`);
}

/**
 * Insert a "key": value pair into a JSONC object before its closing brace.
 * Handles trailing commas and whitespace properly.
 */
function insertIntoObject(
  content: string,
  objEnd: number,
  key: string,
  value: string,
  keyIndent: string,
  braceIndent: string,
): string {
  const closingBrace = objEnd - 1;

  // Find end of last property (skip whitespace before closing brace)
  let pos = closingBrace - 1;
  while (pos >= 0 && (content[pos] === " " || content[pos] === "\t" || content[pos] === "\n" || content[pos] === "\r")) pos--;

  const needsComma = pos >= 0 && content[pos] !== "," && content[pos] !== "{";
  const comma = needsComma ? "," : "";
  pos++;

  const insertion = `${comma}\n${keyIndent}"${key}": ${value}\n${braceIndent}`;
  return content.slice(0, pos) + insertion + content.slice(closingBrace);
}

/**
 * Update vars in an app's wrangler.jsonc/wrangler.json under `env.{environment}.vars`.
 * Surgically replaces only the vars value, preserving all comments and formatting.
 */
export async function updateWranglerVars(
  appPath: string,
  environment: string,
  vars: EnvMap,
): Promise<{ success: boolean; filePath?: string; updatedCount: number }> {
  const configPath = findWranglerConfig(appPath);
  if (!configPath) {
    return { success: false, updatedCount: 0 };
  }

  let content = await readFile(configPath);
  const indent = detectIndent(content);
  const parsed = JSON.parse(stripJsonc(content)) as Record<string, unknown>;

  // Merge with existing vars
  const envSection = (parsed?.env as Record<string, Record<string, unknown>>) ?? {};
  const existingVars = (envSection[environment]?.vars as Record<string, string>) ?? {};
  const mergedVars = { ...existingVars, ...vars };

  const varsJson = reindentJson(JSON.stringify(mergedVars, null, indent), indent.repeat(3));

  // Try to find env.{environment}.vars and replace surgically
  const envRange = findKeyRange(content, "env");
  if (envRange) {
    const envObjRange = findKeyRange(content, environment, envRange[0]);
    if (envObjRange) {
      const varsRange = findKeyRange(content, "vars", envObjRange[0]);
      if (varsRange) {
        // Replace existing vars value
        content = content.slice(0, varsRange[0]) + varsJson + content.slice(varsRange[1]);
        await writeFile(configPath, content);
        return { success: true, filePath: configPath, updatedCount: Object.keys(vars).length };
      }
      // env.{environment} exists but no vars
      content = insertIntoObject(content, envObjRange[1], "vars", varsJson, indent.repeat(3), indent.repeat(2));
      await writeFile(configPath, content);
      return { success: true, filePath: configPath, updatedCount: Object.keys(vars).length };
    }
    // env exists but no {environment} section
    const inner = `{\n${indent.repeat(3)}"vars": ${varsJson}\n${indent.repeat(2)}}`;
    content = insertIntoObject(content, envRange[1], environment, inner, indent.repeat(2), indent);
    await writeFile(configPath, content);
    return { success: true, filePath: configPath, updatedCount: Object.keys(vars).length };
  }

  // No env section at all
  const lastBrace = content.lastIndexOf("}");
  const inner =
    `{\n${indent.repeat(2)}"${environment}": ` +
    `{\n${indent.repeat(3)}"vars": ${varsJson}\n${indent.repeat(2)}}\n${indent}}`;
  content = insertIntoObject(content, lastBrace + 1, "env", inner, indent, "");
  await writeFile(configPath, content);
  return { success: true, filePath: configPath, updatedCount: Object.keys(vars).length };
}

/**
 * Find the full range of a "key": value entry in raw JSONC text.
 * Returns [keyStart, valueEnd] where keyStart is the `"` of the key name.
 */
function findFullKeyRange(text: string, key: string, searchStart = 0): [number, number] | undefined {
  const needle = `"${key}"`;
  let i = searchStart;
  let inString = false;

  while (i < text.length) {
    if (inString) {
      if (text[i] === "\\" && i + 1 < text.length) { i += 2; continue; }
      if (text[i] === '"') inString = false;
      i++;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (text.startsWith(needle, i)) {
      const keyStart = i;
      let j = i + needle.length;
      while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) j++;
      if (text[j] === ":") {
        j++;
        while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\n" || text[j] === "\r")) j++;
        const end = findValueEnd(text, j);
        return [keyStart, end];
      }
    }
    if (text[i] === '"') { inString = true; i++; continue; }
    i++;
  }
  return undefined;
}

/**
 * Remove a "key": value entry from JSONC text, handling commas properly.
 * Only finds keys between searchStart and searchEnd.
 */
function removeJsoncKey(text: string, key: string, searchStart: number, searchEnd: number): string | undefined {
  const range = findFullKeyRange(text, key, searchStart);
  if (!range || range[0] >= searchEnd) return undefined;

  const [keyStart, valueEnd] = range;
  let removeStart = keyStart;
  let removeEnd = valueEnd;

  // Look backward past whitespace for a preceding comma
  let b = keyStart - 1;
  while (b >= 0 && (text[b] === " " || text[b] === "\t" || text[b] === "\n" || text[b] === "\r")) b--;

  if (b >= 0 && text[b] === ",") {
    // Remove preceding comma + whitespace + entry
    removeStart = b;
  } else {
    // No preceding comma — look for trailing comma
    let a = valueEnd;
    while (a < text.length && (text[a] === " " || text[a] === "\t" || text[a] === "\n" || text[a] === "\r")) a++;
    if (a < text.length && text[a] === ",") {
      removeEnd = a + 1;
    }
    // Also eat leading whitespace on the current line
    let lineStart = keyStart - 1;
    while (lineStart >= 0 && (text[lineStart] === " " || text[lineStart] === "\t")) lineStart--;
    if (lineStart >= 0 && text[lineStart] === "\n") {
      removeStart = lineStart;
    }
  }

  return text.slice(0, removeStart) + text.slice(removeEnd);
}

/**
 * Remove `env.{environment}.vars` from an app's wrangler.jsonc/wrangler.json.
 * Preserves all comments and other configuration.
 */
export async function removeWranglerVars(
  appPath: string,
  environments: string[],
  dryRun = false,
): Promise<{ success: boolean; filePath?: string; removedCount: number }> {
  const configPath = findWranglerConfig(appPath);
  if (!configPath) {
    return { success: true, removedCount: 0 };
  }

  let content = await readFile(configPath);
  const parsed = JSON.parse(stripJsonc(content)) as Record<string, unknown>;
  const envSection = (parsed?.env as Record<string, Record<string, unknown>>) ?? {};

  let removedCount = 0;

  for (const environment of environments) {
    if (!envSection[environment]?.vars) continue;
    removedCount++;
    if (dryRun) continue;

    // Re-find ranges each time since content shifts after each removal
    const envRange = findKeyRange(content, "env");
    if (!envRange) continue;

    const envObjRange = findKeyRange(content, environment, envRange[0]);
    if (!envObjRange) continue;

    const result = removeJsoncKey(content, "vars", envObjRange[0], envObjRange[1]);
    if (result !== undefined) {
      content = result;
    }
  }

  if (!dryRun && removedCount > 0) {
    await writeFile(configPath, content);
  }

  return { success: true, filePath: configPath, removedCount };
}
