import { describe, test, expect } from "bun:test";

const FIXTURE = "/Users/hakko/Sources/cf-envsync/tests/fixtures/sample-project";
const CLI = "/Users/hakko/Sources/cf-envsync/src/index.ts";
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

async function runPush(...args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, "push", ...args], {
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
});
