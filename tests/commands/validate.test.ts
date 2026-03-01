import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

const FIXTURE = join(import.meta.dir, "../fixtures/sample-project");
const CLI = join(import.meta.dir, "../../src/index.ts");
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

async function runValidate(...args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", CLI, "validate", ...args], {
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

describe("validate command", () => {
  test("detects missing YOUTUBE_API_KEY in production", async () => {
    const { output, exitCode } = await runValidate("production");
    expect(output).toContain("YOUTUBE_API_KEY");
    expect(exitCode).toBe(1);
  });

  test("staging has all keys present", async () => {
    const { output, exitCode } = await runValidate("staging");
    expect(output).toContain("valid");
    expect(exitCode).toBe(0);
  });

  test("shows check summary with env × app count", async () => {
    const { output } = await runValidate("staging");
    // Should show something like "(1 env × 3 apps)"
    expect(output).toContain("env");
    expect(output).toContain("app");
  });

  test("specific env filter limits environments", async () => {
    const { exitCode } = await runValidate("staging");
    expect(exitCode).toBe(0);
  });

  test("exit code 1 on issues", async () => {
    const { exitCode } = await runValidate("production");
    expect(exitCode).toBe(1);
  });

  test("shows info when first arg treated as app name", async () => {
    const { output } = await runValidate("api");
    expect(output).toContain("not an environment");
    expect(output).toContain("Treating as app name");
  });

  test("exits with error for unknown app names", async () => {
    const { output, exitCode } = await runValidate("nonexistent-app");
    expect(exitCode).toBe(1);
    expect(output).toContain('Unknown app: "nonexistent-app"');
  });
});

describe("validate command (ambiguity detection)", () => {
  const tmpDirs: string[] = [];

  afterAll(async () => {
    for (const d of tmpDirs) {
      await rm(d, { recursive: true }).catch(() => {});
    }
  });

  test("errors when arg matches both env and app name", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "envsync-validate-ambig-"));
    tmpDirs.push(tmpDir);
    const config = {
      environments: ["local", "staging", "production"],
      envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
      encryption: "none",
      apps: {
        staging: {
          path: ".",
          workers: { staging: "staging-worker", production: "prod-worker" },
          secrets: ["KEY"],
        },
      },
    };
    await writeFile(join(tmpDir, "envsync.json"), JSON.stringify(config));
    await writeFile(join(tmpDir, ".env.example"), "KEY=\n");
    await writeFile(join(tmpDir, ".env"), "KEY=val\n");
    await writeFile(join(tmpDir, ".env.staging"), "KEY=val\n");

    const proc = Bun.spawn(
      [process.execPath, "run", CLI, "validate", "staging"],
      { cwd: tmpDir, stdout: "pipe", stderr: "pipe", env: spawnEnv },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = stdout + stderr;
    expect(exitCode).toBe(1);
    expect(output).toContain("ambiguous");
  });
});
