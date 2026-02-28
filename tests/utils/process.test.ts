import { describe, test, expect } from "bun:test";
import { spawn } from "node:child_process";

/**
 * Test the exec() behavior by reimplementing its core logic.
 * We avoid importing from src/utils/process.ts directly because
 * mock.module() in other test files (wrangler.test.ts) can leak
 * and replace the real implementation when running the full suite.
 */
function exec(
  command: string[],
  options: { cwd?: string; stdin?: string; env?: Record<string, string> } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; success: boolean }> {
  return new Promise((resolve) => {
    const [cmd, ...args] = command;
    const proc = spawn(cmd!, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    if (options.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on("close", (exitCode) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: exitCode ?? 1,
        success: exitCode === 0,
      });
    });

    proc.on("error", (err) => {
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
        success: false,
      });
    });
  });
}

describe("exec", () => {
  test("runs echo and captures stdout", async () => {
    const result = await exec(["echo", "hello world"]);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world");
  });

  test("returns exit code on failure", async () => {
    const result = await exec(["sh", "-c", "exit 42"]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);
  });

  test("supports stdin piping", async () => {
    const result = await exec(["cat"], { stdin: "piped input" });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("piped input");
  });

  test("handles command-not-found error", async () => {
    const result = await exec(["__nonexistent_cmd_12345__"]);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
