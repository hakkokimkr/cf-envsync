import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, copyFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";

const FIXTURE = join(import.meta.dir, "../fixtures/sample-project");
const CLI = join(import.meta.dir, "../../src/index.ts");
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

let tmpDir: string;

async function setupTmpProject(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), "envsync-pull-test-"));
  for (const f of [".env", ".env.example", ".env.staging", ".env.production", ".env.local", "envsync.json"]) {
    await copyFile(join(FIXTURE, f), join(tmpDir, f));
  }
  for (const app of ["api", "web", "stream-collector"]) {
    await mkdir(join(tmpDir, "apps", app), { recursive: true });
  }
  return tmpDir;
}

afterAll(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true }).catch(() => {});
});

describe("pull command", () => {
  test("fails gracefully when wrangler not available", async () => {
    const dir = await setupTmpProject();

    const proc = Bun.spawn([process.execPath, "run", CLI, "pull", "staging"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = stdout + stderr;

    // Without wrangler installed, pull should fail with wrangler error
    expect(output).toContain("wrangler");
  });
});
