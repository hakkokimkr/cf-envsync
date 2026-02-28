import { describe, test, expect } from "bun:test";

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
