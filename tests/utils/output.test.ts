import { describe, test, expect, mock, beforeEach } from "bun:test";
import { maskValue, printDiff } from "../../src/utils/output.ts";
import { consola } from "consola";
import type { DiffEntry } from "../../src/types/env.ts";

describe("maskValue", () => {
  test("returns (empty) for undefined/empty", () => {
    expect(maskValue(undefined)).toBe("(empty)");
    expect(maskValue("")).toBe("(empty)");
  });

  test("returns **** for short values (<=4 chars)", () => {
    expect(maskValue("ab")).toBe("****");
    expect(maskValue("abcd")).toBe("****");
  });

  test("shows first 4 chars + **** for longer values", () => {
    expect(maskValue("hello_world")).toBe("hell****");
    expect(maskValue("secret_key_123")).toBe("secr****");
  });
});

describe("printDiff", () => {
  const logs: string[] = [];
  const originalLog = consola.log;

  beforeEach(() => {
    logs.length = 0;
    consola.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  // Restore after all tests in this describe
  test("added entry shows localValue", () => {
    const entries: DiffEntry[] = [
      { key: "NEW_KEY", status: "added", localValue: "local_secret", remoteValue: undefined },
    ];
    printDiff(entries);
    expect(logs.some((l) => l.includes("+ NEW_KEY") && l.includes("loca****"))).toBe(true);
    // Should NOT show remoteValue
    expect(logs.some((l) => l.includes("(empty)"))).toBe(false);
  });

  test("removed entry shows only key name without value", () => {
    const entries: DiffEntry[] = [
      { key: "OLD_KEY", status: "removed", localValue: undefined, remoteValue: undefined },
    ];
    printDiff(entries);
    const removedLine = logs.find((l) => l.includes("- OLD_KEY"));
    expect(removedLine).toBeDefined();
    // Should not have "=" in removed line
    expect(removedLine!.includes("=")).toBe(false);
  });

  test("changed entry shows both local and remote", () => {
    const entries: DiffEntry[] = [
      { key: "CHANGED", status: "changed", localValue: "local_val", remoteValue: "remote_val" },
    ];
    printDiff(entries);
    expect(logs.some((l) => l.includes("~ CHANGED"))).toBe(true);
    expect(logs.some((l) => l.includes("local:") && l.includes("loca****"))).toBe(true);
    expect(logs.some((l) => l.includes("remote:") && l.includes("remo****"))).toBe(true);
  });

  test("unchanged entries are skipped", () => {
    const entries: DiffEntry[] = [
      { key: "SAME", status: "unchanged", localValue: "val", remoteValue: "val" },
    ];
    printDiff(entries);
    // Only the trailing empty line from printDiff
    expect(logs.filter((l) => l.includes("SAME")).length).toBe(0);
  });
});
