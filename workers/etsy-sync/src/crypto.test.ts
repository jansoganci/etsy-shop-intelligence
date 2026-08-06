import { describe, expect, it } from "vitest";
import { buyerHash, decryptSecret, encryptSecret, randomToken, sha256 } from "./crypto";

function testKey(): string {
  return btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index)));
}

describe("Etsy secret protection", () => {
  it("encrypts and decrypts OAuth secrets without storing plaintext", async () => {
    const encrypted = await encryptSecret("sensitive-token", testKey());

    expect(encrypted.ciphertext).not.toContain("sensitive-token");
    expect(encrypted.iv).toBeTruthy();
    await expect(
      decryptSecret(encrypted.ciphertext, encrypted.iv, testKey()),
    ).resolves.toBe("sensitive-token");
  });

  it("creates stable shop-scoped buyer pseudonyms", async () => {
    const first = await buyerHash("private-hmac-secret", "shop-1", "buyer-9");
    const again = await buyerHash("private-hmac-secret", "shop-1", "buyer-9");
    const otherShop = await buyerHash("private-hmac-secret", "shop-2", "buyer-9");

    expect(first).toBe(again);
    expect(first).not.toBe(otherShop);
    expect(first).not.toContain("buyer-9");
  });

  it("generates PKCE-compatible URL-safe tokens and hashes", async () => {
    const token = randomToken(48);
    const digest = await sha256(token);

    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(digest).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

