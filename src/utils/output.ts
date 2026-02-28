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
 * Print a simple key-value table.
 */
export function printTable(
  headers: string[],
  rows: string[][],
): void {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
  );

  const sep = colWidths.map((w) => "─".repeat(w + 2)).join("┼");
  const formatRow = (row: string[]) =>
    row.map((cell, i) => ` ${cell.padEnd(colWidths[i]!)} `).join("│");

  consola.log(formatRow(headers));
  consola.log(sep);
  for (const row of rows) {
    consola.log(formatRow(row));
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
        consola.log(`  + ${entry.key} = ${maskValue(entry.remoteValue)}`);
        break;
      case "removed":
        consola.log(`  - ${entry.key} = ${maskValue(entry.localValue)}`);
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
 */
function maskValue(value?: string): string {
  if (!value) return "(empty)";
  if (value.length <= 4) return "****";
  return value.slice(0, 4) + "****";
}
