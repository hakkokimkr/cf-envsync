import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseEnvLines, isEncrypted } from "../../src/commands/merge.ts";
import { readFile, writeFile } from "../../src/utils/fs.ts";

describe("parseEnvLines", () => {
  test("parses key=value lines", () => {
    const lines = parseEnvLines("FOO=bar\nBAZ=qux");
    expect(lines[0]).toEqual({ key: "FOO", value: "bar", raw: "FOO=bar" });
    expect(lines[1]).toEqual({ key: "BAZ", value: "qux", raw: "BAZ=qux" });
  });

  test("preserves comments", () => {
    const lines = parseEnvLines("# this is a comment\nFOO=bar");
    expect(lines[0]).toEqual({ raw: "# this is a comment" });
    expect(lines[1]!.key).toBe("FOO");
  });

  test("preserves blank lines", () => {
    const lines = parseEnvLines("FOO=bar\n\nBAZ=qux");
    expect(lines[1]).toEqual({ raw: "" });
  });

  test("handles lines without = as raw", () => {
    const lines = parseEnvLines("no-equals-here");
    expect(lines[0]).toEqual({ raw: "no-equals-here" });
  });

  test("handles values with = sign", () => {
    const lines = parseEnvLines("URL=https://example.com?a=1&b=2");
    expect(lines[0]!.key).toBe("URL");
    expect(lines[0]!.value).toBe("https://example.com?a=1&b=2");
  });
});

describe("isEncrypted", () => {
  test("detects encrypted: prefix", () => {
    expect(isEncrypted('KEY="encrypted:abc123"')).toBe(true);
  });

  test("returns false for plain content", () => {
    expect(isEncrypted("KEY=plain_value")).toBe(false);
  });
});

describe("3-way merge", () => {
  const CLI = "/Users/hakko/Sources/cf-envsync/src/index.ts";
  const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };
  let tmpDirs: string[] = [];

  async function doMerge(base: string, ours: string, theirs: string): Promise<string> {
    const tmpDir = await mkdtemp(join(tmpdir(), "envsync-merge-test-"));
    tmpDirs.push(tmpDir);
    const basePath = join(tmpDir, "base");
    const oursPath = join(tmpDir, "ours");
    const theirsPath = join(tmpDir, "theirs");
    await writeFile(basePath, base);
    await writeFile(oursPath, ours);
    await writeFile(theirsPath, theirs);

    const proc = Bun.spawn(
      ["bun", "run", CLI, "merge", basePath, oursPath, theirsPath],
      {
        cwd: "/Users/hakko/Sources/cf-envsync",
        stdout: "pipe",
        stderr: "pipe",
        env: spawnEnv,
      },
    );
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return readFile(oursPath);
  }

  afterAll(async () => {
    for (const d of tmpDirs) {
      await rm(d, { recursive: true }).catch(() => {});
    }
  });

  test("clean merge: both add different keys", async () => {
    const base = "SHARED=1\n";
    const ours = "SHARED=1\nOUR_KEY=a\n";
    const theirs = "SHARED=1\nTHEIR_KEY=b\n";
    const result = await doMerge(base, ours, theirs);
    expect(result).toContain("SHARED=1");
    expect(result).toContain("OUR_KEY=a");
    expect(result).toContain("THEIR_KEY=b");
    expect(result).not.toContain("<<<<<<<");
  });

  test("conflict: same key different values", async () => {
    const base = "KEY=original\n";
    const ours = "KEY=ours_changed\n";
    const theirs = "KEY=theirs_changed\n";
    const result = await doMerge(base, ours, theirs);
    expect(result).toContain("<<<<<<< ours");
    expect(result).toContain("KEY=ours_changed");
    expect(result).toContain("=======");
    expect(result).toContain("KEY=theirs_changed");
    expect(result).toContain(">>>>>>> theirs");
  });

  test("one side changes: theirs wins when ours unchanged", async () => {
    const base = "KEY=original\n";
    const ours = "KEY=original\n";
    const theirs = "KEY=updated\n";
    const result = await doMerge(base, ours, theirs);
    expect(result).toContain("KEY=updated");
    expect(result).not.toContain("<<<<<<<");
  });

  test("key deletion: key removed by theirs", async () => {
    const base = "KEEP=yes\nREMOVE=me\n";
    const ours = "KEEP=yes\nREMOVE=me\n";
    const theirs = "KEEP=yes\n";
    const result = await doMerge(base, ours, theirs);
    expect(result).toContain("KEEP=yes");
    expect(result).not.toContain("REMOVE");
  });
});
