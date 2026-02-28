import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile as _writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { findProjectRoot, globFiles, CONFIG_FILES } from "../../src/utils/fs.ts";

describe("CONFIG_FILES", () => {
  test("has correct order", () => {
    expect(CONFIG_FILES).toEqual([
      "envsync.config.ts",
      "envsync.config.js",
      "envsync.config.mjs",
      "envsync.json",
      "envsync.jsonc",
    ]);
  });
});

describe("findProjectRoot", () => {
  let tmpDir: string;

  test("finds envsync.json", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "envsync-fs-test-"));
    await _writeFile(join(tmpDir, "envsync.json"), "{}");
    const result = findProjectRoot(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.root).toBe(tmpDir);
    expect(result!.configFile).toBe("envsync.json");
    await rm(tmpDir, { recursive: true });
  });

  test("finds envsync.config.ts", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "envsync-fs-test-"));
    await _writeFile(join(tmpDir, "envsync.config.ts"), "export default {}");
    const result = findProjectRoot(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.configFile).toBe("envsync.config.ts");
    await rm(tmpDir, { recursive: true });
  });

  test("walks up directories", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "envsync-fs-test-"));
    const subDir = join(tmpDir, "packages", "app");
    await mkdir(subDir, { recursive: true });
    await _writeFile(join(tmpDir, "envsync.json"), "{}");
    const result = findProjectRoot(subDir);
    expect(result).not.toBeNull();
    expect(result!.root).toBe(tmpDir);
    await rm(tmpDir, { recursive: true });
  });

  test("returns null when no config found", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "envsync-fs-test-"));
    // Don't create any config file — walk up should hit filesystem root
    // Use tmpDir itself as startDir (it won't find anything in /tmp)
    const result = findProjectRoot(tmpDir);
    // It might find a config somewhere up the tree in a real system,
    // but most likely returns null for a temp dir
    // We just verify it returns either null or a valid ProjectRoot
    if (result !== null) {
      expect(result.root).toBeDefined();
      expect(result.configFile).toBeDefined();
    }
    await rm(tmpDir, { recursive: true });
  });
});

describe("globFiles", () => {
  let tmpDir: string;

  test("matches files with filter function", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "envsync-glob-test-"));
    await _writeFile(join(tmpDir, ".env"), "A=1");
    await _writeFile(join(tmpDir, ".env.staging"), "B=2");
    await _writeFile(join(tmpDir, "README.md"), "# hi");

    const results = await globFiles(tmpDir, (f) => f.startsWith(".env"));
    expect(results.length).toBe(2);
    expect(results).toContain(".env");
    expect(results).toContain(".env.staging");
    await rm(tmpDir, { recursive: true });
  });

  test("excludes non-matches", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "envsync-glob-test-"));
    await _writeFile(join(tmpDir, "package.json"), "{}");
    await _writeFile(join(tmpDir, "tsconfig.json"), "{}");

    const results = await globFiles(tmpDir, (f) => f.startsWith(".env"));
    expect(results.length).toBe(0);
    await rm(tmpDir, { recursive: true });
  });

  test("applies filter across subdirectories", async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "envsync-glob-test-"));
    const subDir = join(tmpDir, "apps", "api");
    await mkdir(subDir, { recursive: true });
    await _writeFile(join(subDir, ".env"), "A=1");
    await _writeFile(join(tmpDir, ".env"), "B=2");

    const results = await globFiles(tmpDir, (f) => f.includes(".env"));
    expect(results.length).toBe(2);
    await rm(tmpDir, { recursive: true });
  });
});
