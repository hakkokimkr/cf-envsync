import { describe, test, expect } from "bun:test";
import type { DiffEntry } from "../../src/types/env.ts";

const FIXTURE = "/Users/hakko/Sources/cf-envsync/tests/fixtures/sample-project";
const CLI = "/Users/hakko/Sources/cf-envsync/src/index.ts";
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

async function runDiff(...args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, "diff", ...args], {
    cwd: FIXTURE,
    stdout: "pipe",
    stderr: "pipe",
    env: spawnEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { output: stdout + stderr, exitCode };
}

describe("diff command (env-vs-env mode)", () => {
  test("compares staging vs production", async () => {
    const { output, exitCode } = await runDiff("staging", "production");
    expect(output).toContain("staging");
    expect(output).toContain("production");
    expect(exitCode).toBe(0);
  });

  test("detects keys missing in production", async () => {
    const { output } = await runDiff("staging", "production");
    expect(output).toContain("YOUTUBE_API_KEY");
    expect(output).toContain("missing");
  });
});

describe("diff logic: local-vs-remote DiffEntry construction", () => {
  /**
   * Replicates the inline logic from diff.ts local-vs-remote mode
   * to verify DiffEntry creation independently.
   */
  function buildDiffEntries(
    localMap: Record<string, string>,
    remoteKeys: string[],
  ): DiffEntry[] {
    const localKeys = new Set(Object.keys(localMap));
    const remoteKeySet = new Set(remoteKeys);
    const allKeys = new Set([...localKeys, ...remoteKeySet]);

    const entries: DiffEntry[] = [];
    for (const key of [...allKeys].sort()) {
      const inLocal = localKeys.has(key);
      const inRemote = remoteKeySet.has(key);

      if (inLocal && !inRemote) {
        entries.push({ key, status: "added", localValue: localMap[key] });
      } else if (!inLocal && inRemote) {
        entries.push({ key, status: "removed" });
      } else {
        entries.push({ key, status: "unchanged" });
      }
    }
    return entries;
  }

  test("marks local-only keys as added", () => {
    const entries = buildDiffEntries({ API_KEY: "secret" }, []);
    expect(entries).toEqual([{ key: "API_KEY", status: "added", localValue: "secret" }]);
  });

  test("marks remote-only keys as removed", () => {
    const entries = buildDiffEntries({}, ["OLD_SECRET"]);
    expect(entries).toEqual([{ key: "OLD_SECRET", status: "removed" }]);
  });

  test("marks matching keys as unchanged", () => {
    const entries = buildDiffEntries({ SHARED: "val" }, ["SHARED"]);
    expect(entries).toEqual([{ key: "SHARED", status: "unchanged" }]);
  });

  test("handles mixed keys correctly", () => {
    const entries = buildDiffEntries(
      { A_LOCAL: "1", SHARED: "2" },
      ["SHARED", "Z_REMOTE"],
    );
    expect(entries).toHaveLength(3);
    expect(entries[0]).toEqual({ key: "A_LOCAL", status: "added", localValue: "1" });
    expect(entries[1]).toEqual({ key: "SHARED", status: "unchanged" });
    expect(entries[2]).toEqual({ key: "Z_REMOTE", status: "removed" });
  });

  test("returns empty array when both sides empty", () => {
    const entries = buildDiffEntries({}, []);
    expect(entries).toEqual([]);
  });
});
