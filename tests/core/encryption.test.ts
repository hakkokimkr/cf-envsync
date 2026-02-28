import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decryptEnvContent, findPrivateKey } from "../../src/core/encryption.ts";

describe("decryptEnvContent", () => {
  test("parses plain unencrypted content", () => {
    const content = "FOO=bar\nBAZ=qux\n";
    const result = decryptEnvContent(content);
    expect(result.FOO).toBe("bar");
    expect(result.BAZ).toBe("qux");
  });

  test("parses content with comments and empty lines", () => {
    const content = "# comment\n\nFOO=bar\n";
    const result = decryptEnvContent(content);
    expect(result.FOO).toBe("bar");
    expect(result["# comment"]).toBeUndefined();
  });

  test("restores env vars after key injection", () => {
    const prev = process.env.DOTENV_PRIVATE_KEY;
    const content = "KEY=value\n";
    decryptEnvContent(content, "some-fake-key");
    // After call, DOTENV_PRIVATE_KEY should be restored
    if (prev !== undefined) {
      expect(process.env.DOTENV_PRIVATE_KEY).toBe(prev);
    } else {
      expect(process.env.DOTENV_PRIVATE_KEY).toBeUndefined();
    }
  });
});

describe("findPrivateKey", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original env
    delete process.env.DOTENV_PRIVATE_KEY;
    delete process.env.DOTENV_PRIVATE_KEY_STAGING;
    delete process.env.DOTENV_PRIVATE_KEY_PRODUCTION;
    if (originalEnv.DOTENV_PRIVATE_KEY) {
      process.env.DOTENV_PRIVATE_KEY = originalEnv.DOTENV_PRIVATE_KEY;
    }
  });

  test("returns env-specific key when available", () => {
    process.env.DOTENV_PRIVATE_KEY_STAGING = "staging-key";
    process.env.DOTENV_PRIVATE_KEY = "default-key";
    expect(findPrivateKey("staging")).toBe("staging-key");
  });

  test("falls back to DOTENV_PRIVATE_KEY", () => {
    delete process.env.DOTENV_PRIVATE_KEY_STAGING;
    process.env.DOTENV_PRIVATE_KEY = "default-key";
    expect(findPrivateKey("staging")).toBe("default-key");
  });

  test("returns undefined when no key set", () => {
    delete process.env.DOTENV_PRIVATE_KEY;
    delete process.env.DOTENV_PRIVATE_KEY_STAGING;
    expect(findPrivateKey("staging")).toBeUndefined();
  });

  test("returns DOTENV_PRIVATE_KEY when no env specified", () => {
    process.env.DOTENV_PRIVATE_KEY = "default-key";
    expect(findPrivateKey()).toBe("default-key");
  });

  describe(".env.keys file fallback", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "envsync-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("reads DOTENV_PRIVATE_KEY from .env.keys file", () => {
      delete process.env.DOTENV_PRIVATE_KEY;
      writeFileSync(join(tmpDir, ".env.keys"), "DOTENV_PRIVATE_KEY=file-key\n");
      expect(findPrivateKey(undefined, tmpDir)).toBe("file-key");
    });

    test("reads env-specific key from .env.keys file", () => {
      delete process.env.DOTENV_PRIVATE_KEY;
      delete process.env.DOTENV_PRIVATE_KEY_STAGING;
      writeFileSync(
        join(tmpDir, ".env.keys"),
        "DOTENV_PRIVATE_KEY_STAGING=staging-file-key\nDOTENV_PRIVATE_KEY=default-file-key\n",
      );
      expect(findPrivateKey("staging", tmpDir)).toBe("staging-file-key");
    });

    test("env var takes priority over .env.keys file", () => {
      process.env.DOTENV_PRIVATE_KEY = "env-var-key";
      writeFileSync(join(tmpDir, ".env.keys"), "DOTENV_PRIVATE_KEY=file-key\n");
      expect(findPrivateKey(undefined, tmpDir)).toBe("env-var-key");
    });

    test("returns undefined when no .env.keys file and no env var", () => {
      delete process.env.DOTENV_PRIVATE_KEY;
      expect(findPrivateKey(undefined, tmpDir)).toBeUndefined();
    });

    test("handles .env.keys with comments and blank lines", () => {
      delete process.env.DOTENV_PRIVATE_KEY;
      writeFileSync(
        join(tmpDir, ".env.keys"),
        "# dotenvx keys\n\nDOTENV_PRIVATE_KEY=parsed-key\n# another comment\n",
      );
      expect(findPrivateKey(undefined, tmpDir)).toBe("parsed-key");
    });

    test("handles quoted values in .env.keys", () => {
      delete process.env.DOTENV_PRIVATE_KEY;
      writeFileSync(join(tmpDir, ".env.keys"), 'DOTENV_PRIVATE_KEY="quoted-key"\n');
      expect(findPrivateKey(undefined, tmpDir)).toBe("quoted-key");
    });
  });
});
