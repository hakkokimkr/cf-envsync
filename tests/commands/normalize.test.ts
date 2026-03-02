import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFile, writeFile } from "../../src/utils/fs.ts";

const PROJECT_ROOT = join(import.meta.dir, "../..");
const CLI = join(PROJECT_ROOT, "src/index.ts");
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

let tmpDirs: string[] = [];

afterAll(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true }).catch(() => {});
  }
});

describe("normalize command", () => {
  test("sorts keys alphabetically", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "envsync-normalize-"));
    tmpDirs.push(tmpDir);
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, "ZEBRA=z\nAPPLE=a\nMango=m\n");

    const proc = Bun.spawn([process.execPath, "run", CLI, "normalize", envPath], {
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const result = await readFile(envPath);
    const lines = result.trim().split("\n");
    const keys = lines.map((l) => l.split("=")[0]);
    expect(keys).toEqual(["APPLE", "Mango", "ZEBRA"]);
  });

  test("preserves header comments", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "envsync-normalize-"));
    tmpDirs.push(tmpDir);
    const envPath = join(tmpDir, ".env");
    await writeFile(envPath, "# Header comment\n\nZEBRA=z\nAPPLE=a\n");

    const proc = Bun.spawn([process.execPath, "run", CLI, "normalize", envPath], {
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const result = await readFile(envPath);
    expect(result.startsWith("# Header comment")).toBe(true);
    const kvLines = result
      .split("\n")
      .filter((l) => l.includes("="));
    const keys = kvLines.map((l) => l.split("=")[0]);
    expect(keys).toEqual(["APPLE", "ZEBRA"]);
  });

  test("dry-run does not write", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "envsync-normalize-"));
    tmpDirs.push(tmpDir);
    const envPath = join(tmpDir, ".env");
    const original = "ZEBRA=z\nAPPLE=a\n";
    await writeFile(envPath, original);

    const proc = Bun.spawn([process.execPath, "run", CLI, "normalize", envPath, "--dry-run"], {
      cwd: PROJECT_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const result = await readFile(envPath);
    expect(result).toBe(original);
  });
});
