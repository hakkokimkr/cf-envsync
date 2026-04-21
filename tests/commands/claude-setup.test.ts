import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileExists } from "../../src/utils/fs.ts";

const CLI = join(import.meta.dir, "../../src/index.ts");
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

const tmpDirs: string[] = [];

async function setupProject(opts?: {
  encryption?: "password" | "dotenvx" | "none";
  packageManager?: string;
  lockfile?: "pnpm-lock.yaml" | "yarn.lock" | "bun.lock";
  skipConfig?: boolean;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "envsync-claude-setup-"));
  tmpDirs.push(dir);

  if (!opts?.skipConfig) {
    const config = {
      environments: ["local", "staging", "production"],
      envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
      encryption: opts?.encryption ?? "password",
      apps: {
        api: { path: "apps/api", secrets: ["API_KEY", "DB_URL"], vars: ["PUBLIC_BASE"] },
        web: { path: "apps/web", secrets: ["AUTH_SECRET"] },
      },
    };
    await writeFile(join(dir, "envsync.json"), JSON.stringify(config, null, 2));
  }

  const pkg: Record<string, unknown> = {};
  if (opts?.packageManager) pkg.packageManager = opts.packageManager;
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg));

  if (opts?.lockfile) {
    await writeFile(join(dir, opts.lockfile), "");
  }

  return dir;
}

async function runClaudeSetup(dir: string, args: string[] = ["--force"]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn([process.execPath, "run", CLI, "claude-setup", ...args], {
    cwd: dir,
    env: spawnEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout: stdout + stderr };
}

afterAll(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true }).catch(() => {});
  }
});

describe("claude-setup command", () => {
  test("writes .claude/commands/envsync.md with frontmatter", async () => {
    const dir = await setupProject();
    const { code } = await runClaudeSetup(dir);
    expect(code).toBe(0);

    const outputPath = join(dir, ".claude", "commands", "envsync.md");
    expect(fileExists(outputPath)).toBe(true);

    const content = await readFile(outputPath, "utf-8");
    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("description:");
    expect(content).toContain("# envsync");
  });

  test("reflects environments from config", async () => {
    const dir = await setupProject();
    await runClaudeSetup(dir);
    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).toContain("`local`");
    expect(content).toContain("`staging`");
    expect(content).toContain("`production`");
    expect(content).toMatch(/set staging MY_KEY/);
    expect(content).toMatch(/set production MY_KEY/);
  });

  test("reflects apps from config", async () => {
    const dir = await setupProject();
    await runClaudeSetup(dir);
    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).toContain("**api**");
    expect(content).toContain("**web**");
    expect(content).toContain("secrets 2개, vars 1개");
  });

  test("annotates password encryption", async () => {
    const dir = await setupProject({ encryption: "password" });
    await runClaudeSetup(dir);
    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).toContain("암호화(password)");
    expect(content).toContain(".env.password");
    expect(content).toContain("--raw");
  });

  test("annotates dotenvx encryption", async () => {
    const dir = await setupProject({ encryption: "dotenvx" });
    await runClaudeSetup(dir);
    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).toContain("암호화(dotenvx)");
    expect(content).toContain(".env.keys");
    expect(content).not.toContain("암호화(password)");
  });

  test("omits encryption notes when encryption is none", async () => {
    const dir = await setupProject({ encryption: "none" });
    await runClaudeSetup(dir);
    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).not.toContain("암호화(password)");
    expect(content).not.toContain("암호화(dotenvx)");
  });

  test("uses pnpm prefix when pnpm-lock.yaml exists", async () => {
    const dir = await setupProject({ lockfile: "pnpm-lock.yaml" });
    await runClaudeSetup(dir);
    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).toContain("pnpm envsync get");
    expect(content).not.toContain("npx envsync get");
  });

  test("uses bunx prefix when bun.lock exists", async () => {
    const dir = await setupProject({ lockfile: "bun.lock" });
    await runClaudeSetup(dir);
    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).toContain("bunx envsync get");
  });

  test("uses package.json packageManager field over lockfile", async () => {
    const dir = await setupProject({
      packageManager: "yarn@4.0.0",
      lockfile: "pnpm-lock.yaml",
    });
    await runClaudeSetup(dir);
    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).toContain("yarn envsync get");
    expect(content).not.toContain("pnpm envsync get");
  });

  test("defaults to npx when no lockfile or packageManager", async () => {
    const dir = await setupProject();
    await runClaudeSetup(dir);
    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).toContain("npx envsync get");
  });

  test("falls back to generic doc when no config", async () => {
    const dir = await setupProject({ skipConfig: true });
    const { code, stdout } = await runClaudeSetup(dir);
    expect(code).toBe(0);
    expect(stdout).toContain("No envsync config found");

    const content = await readFile(join(dir, ".claude", "commands", "envsync.md"), "utf-8");
    expect(content).toContain("envsync.config.ts");
    expect(content).not.toContain("**api**");
  });

  test("--dry-run does not create the file", async () => {
    const dir = await setupProject();
    const { code, stdout } = await runClaudeSetup(dir, ["--dry-run"]);
    expect(code).toBe(0);
    expect(stdout).toContain("dry-run");
    expect(fileExists(join(dir, ".claude", "commands", "envsync.md"))).toBe(false);
  });

  test("--path writes to a custom location", async () => {
    const dir = await setupProject();
    const { code } = await runClaudeSetup(dir, ["--force", "--path", ".claude/commands/env.md"]);
    expect(code).toBe(0);
    expect(fileExists(join(dir, ".claude", "commands", "env.md"))).toBe(true);
    expect(fileExists(join(dir, ".claude", "commands", "envsync.md"))).toBe(false);
  });

  test("--force overwrites existing file without prompting", async () => {
    const dir = await setupProject();
    await runClaudeSetup(dir, ["--force"]);
    const outputPath = join(dir, ".claude", "commands", "envsync.md");
    await writeFile(outputPath, "old content");

    const { code } = await runClaudeSetup(dir, ["--force"]);
    expect(code).toBe(0);
    const content = await readFile(outputPath, "utf-8");
    expect(content).not.toBe("old content");
    expect(content).toContain("envsync");
  });
});
