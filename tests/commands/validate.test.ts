import { describe, test, expect } from "bun:test";

const FIXTURE = "/Users/hakko/Sources/cf-envsync/tests/fixtures/sample-project";
const CLI = "/Users/hakko/Sources/cf-envsync/src/index.ts";
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

async function runValidate(...args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, "validate", ...args], {
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

  test("specific env filter limits environments", async () => {
    const { exitCode } = await runValidate("staging");
    expect(exitCode).toBe(0);
  });

  test("exit code 1 on issues", async () => {
    const { exitCode } = await runValidate("production");
    expect(exitCode).toBe(1);
  });
});
