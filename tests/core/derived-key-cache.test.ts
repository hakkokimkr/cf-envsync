/**
 * Pins the scrypt key-derivation cache added in `src/core/encryption.ts`.
 *
 * Why the cache exists (measured on a 13-app monorepo, 2026-09-28):
 * `resolveAppEnv` re-reads and re-decrypts the whole root `.env.<env>` once per
 * app, so the same (salt, password) pairs are derived over and over —
 * 66 encrypted values x 13 apps = 858 `scryptSync` calls, ~32s on a 2-vCPU CI
 * runner. Caching leaves 66 derivations (-92%).
 *
 * ⚠️ The dangerous failure mode is a cache keyed on the salt alone: two
 *    different passwords share a salt only if an attacker arranges it, but a
 *    salt-only key would make `decryptValue` return the *first* password's key
 *    for the second password — turning "wrong password" into silent garbage or,
 *    worse, a successful decrypt. `it("does not confuse two passwords…")`
 *    below is the test that catches that, and it needs no timing at all.
 */
import { describe, test, expect } from "bun:test";
import {
  encryptValue,
  decryptValue,
  encryptEnvMap,
  decryptEnvMap,
} from "../../src/core/encryption.ts";

describe("derived key cache", () => {
  test("decrypting the same token twice yields the same plaintext", () => {
    const token = encryptValue("value-A", "pw-1");
    expect(decryptValue(token, "pw-1")).toBe("value-A");
    expect(decryptValue(token, "pw-1")).toBe("value-A");
  });

  test("does not confuse two passwords — a wrong password still fails after a correct one", () => {
    // 🔴 This is the test that a salt-only cache key would fail.
    const token = encryptValue("secret", "right-password");
    expect(decryptValue(token, "right-password")).toBe("secret");
    expect(() => decryptValue(token, "wrong-password")).toThrow();
    // ...and the correct password must still work after the failure.
    expect(decryptValue(token, "right-password")).toBe("secret");
  });

  test("distinct values keep distinct plaintexts (each has its own salt)", () => {
    const password = "pw-2";
    const map = { A: "alpha", B: "beta", C: "gamma" };
    const encrypted = encryptEnvMap(map, password);
    expect(decryptEnvMap(encrypted, password)).toEqual(map);
    // Decrypting the same map again must not smear values into each other.
    expect(decryptEnvMap(encrypted, password)).toEqual(map);
  });

  test("the same plaintext encrypted twice decrypts independently", () => {
    const password = "pw-3";
    const a = encryptValue("same", password);
    const b = encryptValue("same", password);
    expect(a).not.toBe(b); // different salt/iv
    expect(decryptValue(a, password)).toBe("same");
    expect(decryptValue(b, password)).toBe("same");
  });

  test("re-decrypting a map is much cheaper than the first pass", () => {
    /* The point of the cache. scrypt is ~19ms per derivation, so the first pass
     * over 12 values costs ~230ms and the second should be ~0ms. Asserting a
     * 4x margin instead of an absolute bound keeps this honest on slow CI:
     * the real ratio measured is ~1000x, so 4x fails loudly if the cache goes
     * away and never flakes while it is there. */
    const password = "pw-4";
    const plain: Record<string, string> = {};
    for (let i = 0; i < 12; i++) plain[`K${i}`] = `v${i}`;
    const encrypted = encryptEnvMap(plain, password);

    const t0 = performance.now();
    expect(decryptEnvMap(encrypted, password)).toEqual(plain);
    const first = performance.now() - t0;

    const t1 = performance.now();
    expect(decryptEnvMap(encrypted, password)).toEqual(plain);
    const second = performance.now() - t1;

    expect(second).toBeLessThan(first / 4);
  });
});
