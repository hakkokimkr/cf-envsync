import { describe, test, expect } from "bun:test";
import { join } from "node:path";

const FIXTURE = join(import.meta.dir, "../fixtures/sample-project");
const CLI = join(import.meta.dir, "../../src/index.ts");
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

async function runList(...args: string[]): Promise<{ output: string; exitCode: number }> {
  const proc = Bun.spawn([process.execPath, "run", CLI, "list", ...args], {
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

describe("list command", () => {
  test("outputs all apps", async () => {
    const { output, exitCode } = await runList();
    expect(output).toContain("api");
    expect(output).toContain("web");
    expect(output).toContain("stream-collector");
    expect(exitCode).toBe(0);
  });

  test("--keys shows key names", async () => {
    const { output, exitCode } = await runList("--keys");
    expect(output).toContain("DATABASE_URL");
    expect(output).toContain("JWT_SECRET");
    expect(output).toContain("AUTH_SECRET");
    expect(output).toContain("VITE_API_URL");
    expect(exitCode).toBe(0);
  });

  test("single app filter", async () => {
    const { output, exitCode } = await runList("api");
    expect(output).toContain("api");
    expect(exitCode).toBe(0);
  });

  test("shows shared secrets info", async () => {
    const { output } = await runList();
    expect(output).toContain("Shared secrets");
    expect(output).toContain("JWT_SECRET");
  });
});
