import { consola } from "consola";
import type { DiffEntry } from "../types/env.ts";

/**
 * Print a tree structure for apps and their env files.
 */
export function printTree(
  title: string,
  items: { label: string; children?: string[] }[],
): void {
  consola.log(`\n${title}`);
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const isLast = i === items.length - 1;
    const prefix = isLast ? "└─" : "├─";
    consola.log(`  ${prefix} ${item.label}`);
    if (item.children) {
      for (let j = 0; j < item.children.length; j++) {
        const child = item.children[j]!;
        const childPrefix = isLast ? "   " : "│  ";
        const childConnector = j === item.children.length - 1 ? "└─" : "├─";
        consola.log(`  ${childPrefix} ${childConnector} ${child}`);
      }
    }
  }
  consola.log("");
}

/**
 * Print a diff view of env changes.
 */
export function printDiff(entries: DiffEntry[]): void {
  for (const entry of entries) {
    switch (entry.status) {
      case "added":
        consola.log(`  + ${entry.key} = ${maskValue(entry.localValue)}`);
        break;
      case "removed":
        consola.log(`  - ${entry.key}`);
        break;
      case "changed":
        consola.log(`  ~ ${entry.key}`);
        consola.log(`    local:  ${maskValue(entry.localValue)}`);
        consola.log(`    remote: ${maskValue(entry.remoteValue)}`);
        break;
      case "unchanged":
        // skip unchanged by default
        break;
    }
  }
  consola.log("");
}

/**
 * Mask a secret value for display: show first 4 chars + "***".
 * `missingLabel` is used when the value is undefined or empty (defaults to "(empty)").
 */
export function maskValue(value?: string, missingLabel = "(empty)"): string {
  if (!value) return missingLabel;
  if (value.length <= 4) return "****";
  return value.slice(0, 4) + "****";
}
