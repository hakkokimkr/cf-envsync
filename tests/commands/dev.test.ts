import { describe, test, expect, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, mkdir, copyFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileExists } from "../../src/utils/fs.ts";
import { loadEnvFile } from "../../src/core/env-file.ts";

const FIXTURE = join(import.meta.dir, "../fixtures/sample-project");
const CLI = join(import.meta.dir, "../../src/index.ts");
const spawnEnv = { ...process.env, CONSOLA_LEVEL: "5" };

let tmpDirs: string[] = [];

async function setupTmpProject(): Promise<string> {
  const tmpDir = await mkdtemp(join(tmpdir(), "envsync-dev-test-"));
  tmpDirs.push(tmpDir);
  for (const f of [".env", ".env.example", ".env.staging", ".env.production", ".env.local", "envsync.json"]) {
    await copyFile(join(FIXTURE, f), join(tmpDir, f));
  }
  for (const app of ["api", "web", "stream-collector"]) {
    await mkdir(join(tmpDir, "apps", app), { recursive: true });
  }
  return tmpDir;
}

afterAll(async () => {
  for (const d of tmpDirs) {
    await rm(d, { recursive: true }).catch(() => {});
  }
});

describe("dev command", () => {
  test("writes correct .dev.vars files", async () => {
    const dir = await setupTmpProject();
    const proc = Bun.spawn([process.execPath, "run", CLI, "dev"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const apiDevVars = join(dir, "apps", "api", ".dev.vars");
    expect(fileExists(apiDevVars)).toBe(true);

    const apiEnv = await loadEnvFile(apiDevVars);
    expect(apiEnv.DATABASE_URL).toBe("postgres://localhost:5432/enterfun_dev");
    expect(apiEnv.JWT_SECRET).toBe("dev_jwt_secret");

    const webDevVars = join(dir, "apps", "web", ".dev.vars");
    expect(fileExists(webDevVars)).toBe(true);

    const webEnv = await loadEnvFile(webDevVars);
    expect(webEnv.AUTH_SECRET).toBe("dev_auth_secret");
    expect(webEnv.VITE_API_URL).toBe("http://localhost:8787");
  });

  test("dry-run does not write .dev.vars", async () => {
    const dir = await setupTmpProject();
    const proc = Bun.spawn([process.execPath, "run", CLI, "dev", "--dry-run"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const apiDevVars = join(dir, "apps", "api", ".dev.vars");
    expect(fileExists(apiDevVars)).toBe(false);
  });

  test("app filter works", async () => {
    const dir = await setupTmpProject();
    const proc = Bun.spawn([process.execPath, "run", CLI, "dev", "api"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(fileExists(join(dir, "apps", "api", ".dev.vars"))).toBe(true);
    expect(fileExists(join(dir, "apps", "web", ".dev.vars"))).toBe(false);
    expect(fileExists(join(dir, "apps", "stream-collector", ".dev.vars"))).toBe(false);
  });

  test("devFile: string generates custom output file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envsync-devfile-"));
    tmpDirs.push(dir);
    const config = {
      environments: ["local", "staging"],
      envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
      encryption: "none",
      apps: {
        web: {
          path: ".",
          workers: { staging: "web-staging" },
          vars: ["VITE_API_URL"],
          devFile: ".env.development",
        },
      },
    };
    await writeFile(join(dir, "envsync.json"), JSON.stringify(config));
    await writeFile(join(dir, ".env"), "VITE_API_URL=http://localhost:3000\n");

    const proc = Bun.spawn([process.execPath, "run", CLI, "dev"], {
      cwd: dir, stdout: "pipe", stderr: "pipe", env: spawnEnv,
    });
    await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

    expect(fileExists(join(dir, ".env.development"))).toBe(true);
    expect(fileExists(join(dir, ".dev.vars"))).toBe(false);
    const env = await loadEnvFile(join(dir, ".env.development"));
    expect(env.VITE_API_URL).toBe("http://localhost:3000");
  });

  test("devFile: array generates multiple output files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envsync-devfile-multi-"));
    tmpDirs.push(dir);
    const config = {
      environments: ["local", "staging"],
      envFiles: { pattern: ".env.{env}", local: ".env.local", perApp: false },
      encryption: "none",
      apps: {
        web: {
          path: ".",
          workers: { staging: "web-staging" },
          vars: ["VITE_API_URL"],
          devFile: [".dev.vars", ".env.development"],
        },
      },
    };
    await writeFile(join(dir, "envsync.json"), JSON.stringify(config));
    await writeFile(join(dir, ".env"), "VITE_API_URL=http://localhost:3000\n");

    const proc = Bun.spawn([process.execPath, "run", CLI, "dev"], {
      cwd: dir, stdout: "pipe", stderr: "pipe", env: spawnEnv,
    });
    await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);

    expect(fileExists(join(dir, ".dev.vars"))).toBe(true);
    expect(fileExists(join(dir, ".env.development"))).toBe(true);
    const env1 = await loadEnvFile(join(dir, ".dev.vars"));
    const env2 = await loadEnvFile(join(dir, ".env.development"));
    expect(env1.VITE_API_URL).toBe("http://localhost:3000");
    expect(env2.VITE_API_URL).toBe("http://localhost:3000");
  });

  test("shows per-dev override info when using non-local env", async () => {
    const dir = await setupTmpProject();
    const proc = Bun.spawn([process.execPath, "run", CLI, "dev", "--env", "staging"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = stdout + stderr;
    expect(output).toContain("Per-dev overrides are only applied");
  });
});
