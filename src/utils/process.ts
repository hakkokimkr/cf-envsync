import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface ExecOptions {
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
}

/**
 * Execute a command and return its output.
 * Supports stdin piping for commands like `wrangler secret bulk`.
 * Uses node:child_process for cross-runtime compatibility.
 */
export async function exec(
  command: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
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
