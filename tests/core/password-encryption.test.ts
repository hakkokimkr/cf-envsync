import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  encryptValue,
  decryptValue,
  isEnvsyncEncrypted,
  encryptEnvMap,
  decryptEnvMap,
  findPassword,
} from "../../src/core/encryption.ts";

describe("encryptValue / decryptValue", () => {
  const password = "test-password-123";

  test("round-trips a simple value", () => {
    const encrypted = encryptValue("hello world", password);
    expect(encrypted).toStartWith("envsync:v1:");
    const decrypted = decryptValue(encrypted, password);
    expect(decrypted).toBe("hello world");
  });

  test("round-trips an empty string value", () => {
    const encrypted = encryptValue("", password);
    const decrypted = decryptValue(encrypted, password);
    expect(decrypted).toBe("");
  });

  test("round-trips a value with special characters", () => {
    const value = 'postgres://user:p@ss=word&more#here/db?ssl=true';
    const encrypted = encryptValue(value, password);
    const decrypted = decryptValue(encrypted, password);
    expect(decrypted).toBe(value);
  });

  test("round-trips a multi-line value", () => {
    const value = "line1\nline2\nline3";
    const encrypted = encryptValue(value, password);
    const decrypted = decryptValue(encrypted, password);
    expect(decrypted).toBe(value);
  });

  test("produces different ciphertext for the same value (unique salt/iv)", () => {
    const a = encryptValue("same-value", password);
    const b = encryptValue("same-value", password);
    expect(a).not.toBe(b);
    // Both should decrypt to the same value
    expect(decryptValue(a, password)).toBe("same-value");
    expect(decryptValue(b, password)).toBe("same-value");
  });

  test("fails with wrong password", () => {
    const encrypted = encryptValue("secret", password);
    expect(() => decryptValue(encrypted, "wrong-password")).toThrow();
  });

  test("throws on non-envsync token", () => {
    expect(() => decryptValue("not-encrypted", password)).toThrow(
      "Not an envsync-encrypted value",
    );
  });
});

describe("isEnvsyncEncrypted", () => {
  test("returns true for envsync-encrypted values", () => {
    expect(isEnvsyncEncrypted("envsync:v1:abc123")).toBe(true);
  });

  test("returns false for plain values", () => {
    expect(isEnvsyncEncrypted("hello")).toBe(false);
  });

  test("returns false for dotenvx-encrypted values", () => {
    expect(isEnvsyncEncrypted("encrypted:abc123")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isEnvsyncEncrypted("")).toBe(false);
  });
});

describe("encryptEnvMap / decryptEnvMap", () => {
  const password = "map-test-password";

  test("round-trips an env map", () => {
    const original = { KEY1: "value1", KEY2: "value2" };
    const encrypted = encryptEnvMap(original, password);
    expect(isEnvsyncEncrypted(encrypted.KEY1)).toBe(true);
    expect(isEnvsyncEncrypted(encrypted.KEY2)).toBe(true);
    const decrypted = decryptEnvMap(encrypted, password);
    expect(decrypted).toEqual(original);
  });

  test("skips already-encrypted values during encrypt", () => {
    const token = encryptValue("pre-encrypted", password);
    const map = { PLAIN: "hello", ENCRYPTED: token };
    const encrypted = encryptEnvMap(map, password);
    expect(encrypted.ENCRYPTED).toBe(token); // unchanged
    expect(isEnvsyncEncrypted(encrypted.PLAIN)).toBe(true);
  });

  test("skips empty values during encrypt", () => {
    const map = { FILLED: "value", EMPTY: "" };
    const encrypted = encryptEnvMap(map, password);
    expect(encrypted.EMPTY).toBe("");
    expect(isEnvsyncEncrypted(encrypted.FILLED)).toBe(true);
  });

  test("passes through non-encrypted values during decrypt", () => {
    const map = { PLAIN: "not-encrypted", ENCRYPTED: encryptValue("secret", password) };
    const decrypted = decryptEnvMap(map, password);
    expect(decrypted.PLAIN).toBe("not-encrypted");
    expect(decrypted.ENCRYPTED).toBe("secret");
  });
});

describe("findPassword", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    delete process.env.ENVSYNC_PASSWORD;
    delete process.env.ENVSYNC_PASSWORD_STAGING;
    delete process.env.ENVSYNC_PASSWORD_PRODUCTION;
    if (originalEnv.ENVSYNC_PASSWORD) {
      process.env.ENVSYNC_PASSWORD = originalEnv.ENVSYNC_PASSWORD;
    }
  });

  test("returns env-specific password when available", () => {
    process.env.ENVSYNC_PASSWORD_STAGING = "staging-pw";
    process.env.ENVSYNC_PASSWORD = "default-pw";
    expect(findPassword("staging")).toBe("staging-pw");
  });

  test("falls back to ENVSYNC_PASSWORD", () => {
    delete process.env.ENVSYNC_PASSWORD_STAGING;
    process.env.ENVSYNC_PASSWORD = "default-pw";
    expect(findPassword("staging")).toBe("default-pw");
  });

  test("returns undefined when no password set", () => {
    delete process.env.ENVSYNC_PASSWORD;
    delete process.env.ENVSYNC_PASSWORD_STAGING;
    expect(findPassword("staging")).toBeUndefined();
  });

  test("returns ENVSYNC_PASSWORD when no env specified", () => {
    process.env.ENVSYNC_PASSWORD = "default-pw";
    expect(findPassword()).toBe("default-pw");
  });

  describe(".env.password file fallback", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "envsync-pw-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("reads ENVSYNC_PASSWORD from .env.password file", () => {
      delete process.env.ENVSYNC_PASSWORD;
      writeFileSync(join(tmpDir, ".env.password"), "ENVSYNC_PASSWORD=file-pw\n");
      expect(findPassword(undefined, tmpDir)).toBe("file-pw");
    });

    test("reads env-specific password from .env.password file", () => {
      delete process.env.ENVSYNC_PASSWORD;
      delete process.env.ENVSYNC_PASSWORD_STAGING;
      writeFileSync(
        join(tmpDir, ".env.password"),
        "ENVSYNC_PASSWORD_STAGING=staging-file-pw\nENVSYNC_PASSWORD=default-file-pw\n",
      );
      expect(findPassword("staging", tmpDir)).toBe("staging-file-pw");
    });

    test("env var takes priority over .env.password file", () => {
      process.env.ENVSYNC_PASSWORD = "env-var-pw";
      writeFileSync(join(tmpDir, ".env.password"), "ENVSYNC_PASSWORD=file-pw\n");
      expect(findPassword(undefined, tmpDir)).toBe("env-var-pw");
    });

    test("returns undefined when no .env.password file and no env var", () => {
      delete process.env.ENVSYNC_PASSWORD;
      expect(findPassword(undefined, tmpDir)).toBeUndefined();
    });

    test("handles quoted values in .env.password", () => {
      delete process.env.ENVSYNC_PASSWORD;
      writeFileSync(join(tmpDir, ".env.password"), 'ENVSYNC_PASSWORD="quoted-pw"\n');
      expect(findPassword(undefined, tmpDir)).toBe("quoted-pw");
    });
  });
});
