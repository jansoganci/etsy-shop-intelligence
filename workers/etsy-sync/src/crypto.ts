const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64Url(new Uint8Array(digest));
}

async function encryptionKey(encodedKey: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(encodedKey.trim());
  if (bytes.byteLength !== 32) {
    throw new Error("ETSY_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return crypto.subtle.importKey("raw", arrayBuffer(bytes), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptSecret(
  value: string,
  encodedKey: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const result = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(encodedKey),
    encoder.encode(value),
  );
  return {
    ciphertext: bytesToBase64(new Uint8Array(result)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptSecret(
  ciphertext: string,
  iv: string,
  encodedKey: string,
): Promise<string> {
  const result = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: arrayBuffer(base64ToBytes(iv)) },
    await encryptionKey(encodedKey),
    arrayBuffer(base64ToBytes(ciphertext)),
  );
  return decoder.decode(result);
}

export async function buyerHash(
  hashKey: string,
  shopId: string,
  buyerId: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(encoder.encode(hashKey)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    arrayBuffer(encoder.encode(`${shopId}:${buyerId}`)),
  );
  return base64Url(new Uint8Array(signature));
}

export function randomToken(size = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}
