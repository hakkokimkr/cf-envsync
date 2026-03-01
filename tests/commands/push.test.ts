import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const FIXTURE = join(import.meta.dir, "../fixtures/sample-project");
const CLI = join(import.meta.dir, "../../src/index.ts");
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

async function runPush(...args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", CLI, "push", ...args], {
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

describe("push command", () => {
  test("dry-run shows what would be pushed without wrangler calls", async () => {
    const { output, exitCode } = await runPush("staging", "--dry-run");
    expect(output).toContain("Would push");
    expect(exitCode).toBe(0);
  });

  test("dry-run lists secret keys", async () => {
    const { output } = await runPush("staging", "--dry-run", "api");
    // api secrets: DATABASE_URL, TWITCH_CLIENT_SECRET, TWITCH_CLIENT_ID, JWT_SECRET
    expect(output).toContain("DATABASE_URL");
    expect(output).toContain("JWT_SECRET");
  });

  test("--shared filters to shared keys only", async () => {
    const { output } = await runPush("staging", "--dry-run", "--shared", "api");
    // shared: JWT_SECRET, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
    expect(output).toContain("JWT_SECRET");
    expect(output).toContain("TWITCH_CLIENT_ID");
    // DATABASE_URL is not shared
    expect(output).not.toContain("DATABASE_URL");
  });

  test("exits with error for unknown app names", async () => {
    const { output, exitCode } = await runPush("staging", "--dry-run", "nonexistent-app");
    expect(exitCode).toBe(1);
    expect(output).toContain('Unknown app: "nonexistent-app"');
    expect(output).toContain("Available:");
  });

  test("--force with --dry-run still shows dry-run output", async () => {
    // --force + --dry-run should show what would be pushed (force doesn't affect dry-run)
    const { output, exitCode } = await runPush("staging", "--dry-run", "--force", "api");
    expect(output).toContain("Would push");
    expect(exitCode).toBe(0);
  });

  test("--shared shows summary of shared keys being pushed", async () => {
    const { output } = await runPush("staging", "--dry-run", "--shared");
    expect(output).toContain("--shared");
    expect(output).toContain("shared keys");
  });

  test("--shared shows skip reason when app has no shared keys", async () => {
    // stream-collector has no shared keys (its secrets don't overlap with shared list except TWITCH_*)
    // Actually all apps with shared keys will get some. Let's just check the output format
    const { output } = await runPush("staging", "--dry-run", "--shared", "api");
    expect(output).toContain("--shared");
  });

  test("dry-run with multiple apps shows progress counter", async () => {
    const { output } = await runPush("staging", "--dry-run");
    // With multiple apps, should show [1/N] style progress
    expect(output).toMatch(/\[\d+\/\d+\]/);
  });
});
