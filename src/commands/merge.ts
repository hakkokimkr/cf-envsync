import { defineCommand } from "citty";
import { consola } from "consola";
import { readFile, writeFile } from "../utils/fs.ts";
import { decryptEnvContent, findPrivateKey } from "../core/encryption.ts";
import { exec } from "../utils/process.ts";

/**
 * Parse .env content into an ordered list of entries.
 * Preserves comments and blank lines.
 */
export function parseEnvLines(content: string): { key?: string; value?: string; raw: string }[] {
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

/**
 * Check if content appears to be dotenvx-encrypted.
 */
export function isEncrypted(content: string): boolean {
  return content.includes("encrypted:");
}

/**
 * 3-way merge for .env files.
 * Usage as git merge driver: envsync merge %O %A %B
 * - %O = ancestor (base)
 * - %A = ours (current)
 * - %B = theirs (incoming)
 *
 * Strategy:
 * 1. Decrypt all three files if encrypted
 * 2. Key-level 3-way merge
 * 3. If both sides changed the same key to different values → conflict marker
 * 4. Re-encrypt result if original was encrypted
 */
export default defineCommand({
  meta: {
    name: "merge",
    description: "3-way merge driver for .env files",
  },
  args: {
    base: {
      type: "positional",
      description: "Base (ancestor) file path",
      required: true,
    },
    ours: {
      type: "positional",
      description: "Ours (current) file path",
      required: true,
    },
    theirs: {
      type: "positional",
      description: "Theirs (incoming) file path",
      required: true,
    },
  },
  async run({ args }) {
    const [baseContent, oursContent, theirsContent] = await Promise.all([
      readFile(args.base),
      readFile(args.ours),
      readFile(args.theirs),
    ]);

    const wasEncrypted = isEncrypted(oursContent);
    const privateKey = findPrivateKey();

    // Decrypt if encrypted
    const baseParsed = isEncrypted(baseContent)
      ? decryptEnvContent(baseContent, privateKey)
      : Object.fromEntries(
          parseEnvLines(baseContent)
            .filter((e) => e.key)
            .map((e) => [e.key!, e.value ?? ""]),
        );

    const oursParsed = isEncrypted(oursContent)
      ? decryptEnvContent(oursContent, privateKey)
      : Object.fromEntries(
          parseEnvLines(oursContent)
            .filter((e) => e.key)
            .map((e) => [e.key!, e.value ?? ""]),
        );

    const theirsParsed = isEncrypted(theirsContent)
      ? decryptEnvContent(theirsContent, privateKey)
      : Object.fromEntries(
          parseEnvLines(theirsContent)
            .filter((e) => e.key)
            .map((e) => [e.key!, e.value ?? ""]),
        );

    // Build key maps
    const baseMap = new Map(Object.entries(baseParsed));
    const oursMap = new Map(Object.entries(oursParsed));
    const theirsMap = new Map(Object.entries(theirsParsed));

    // Collect all keys preserving order from ours, then new from theirs
    const allKeys: string[] = [];
    const seen = new Set<string>();
    for (const key of oursMap.keys()) {
      if (!seen.has(key)) {
        allKeys.push(key);
        seen.add(key);
      }
    }
    for (const key of theirsMap.keys()) {
      if (!seen.has(key)) {
        allKeys.push(key);
        seen.add(key);
      }
    }

    let hasConflicts = false;
    const resultLines: string[] = [];

    // Preserve header comments from ours
    const oursLines = parseEnvLines(oursContent);
    for (const e of oursLines) {
      if (e.key) break;
      resultLines.push(e.raw);
    }

    for (const key of allKeys) {
      const baseVal = baseMap.get(key);
      const oursVal = oursMap.get(key);
      const theirsVal = theirsMap.get(key);

      if (oursVal === theirsVal) {
        if (oursVal !== undefined) {
          resultLines.push(`${key}=${oursVal}`);
        }
      } else if (oursVal === baseVal) {
        // Only theirs changed
        if (theirsVal !== undefined) {
          resultLines.push(`${key}=${theirsVal}`);
        }
      } else if (theirsVal === baseVal) {
        // Only ours changed
        if (oursVal !== undefined) {
          resultLines.push(`${key}=${oursVal}`);
        }
      } else {
        // Both changed differently — conflict
        hasConflicts = true;
        resultLines.push(`<<<<<<< ours`);
        if (oursVal !== undefined) resultLines.push(`${key}=${oursVal}`);
        resultLines.push(`=======`);
        if (theirsVal !== undefined) resultLines.push(`${key}=${theirsVal}`);
        resultLines.push(`>>>>>>> theirs`);
      }
    }

    const mergedContent = resultLines.join("\n") + "\n";

    if (wasEncrypted && !hasConflicts) {
      // Re-encrypt: write plain text, then run dotenvx encrypt
      await writeFile(args.ours, mergedContent);
      const result = await exec(["dotenvx", "encrypt", "-f", args.ours]);
      if (!result.success) {
        consola.warn("Could not re-encrypt merged file:", result.stderr);
      }
    } else {
      await writeFile(args.ours, mergedContent);
    }

    if (hasConflicts) {
      consola.warn("Merge conflicts detected. Please resolve manually.");
      process.exit(1);
    }

    // Exit 0 on clean merge (git merge driver requirement)
    process.exit(0);
  },
});
