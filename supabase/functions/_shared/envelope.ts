/** AES-GCM envelope. The KEK is an Edge Function secret. The API key never leaves the server. */

const te = new TextEncoder();
const td = new TextDecoder();

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `\\x${hex}`;
}

export function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith("\\x") ? value.slice(2) : value;
  if (hex.length % 2 !== 0) throw new Error("ciphertext is not hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function decodeKek(secret: string): Uint8Array {
  const cleaned = secret.trim();
  const bytes = Uint8Array.from(atob(cleaned), (char) => char.charCodeAt(0));
  if (bytes.length !== 32) {
    throw new Error("SUMIT_KEK must be 32 bytes, base64");
  }
  return bytes;
}

function tight(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function importKey(raw: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", tight(raw), { name: "AES-GCM" }, false, [usage]);
}

export async function aesGcmEncrypt(
  key: Uint8Array,
  plain: Uint8Array,
  additionalData?: Uint8Array,
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await importKey(key, "encrypt");
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: tight(nonce), additionalData: additionalData ? tight(additionalData) : undefined },
      cryptoKey,
      tight(plain),
    ),
  );
  return { ciphertext: cipher, nonce };
}

export async function aesGcmDecrypt(
  key: Uint8Array,
  ciphertext: Uint8Array,
  nonce: Uint8Array,
  additionalData?: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await importKey(key, "decrypt");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: tight(nonce), additionalData: additionalData ? tight(additionalData) : undefined },
    cryptoKey,
    tight(ciphertext),
  );
  return new Uint8Array(plain);
}

export interface Envelope {
  keyCiphertext: string;
  keyNonce: string;
  dekCiphertext: string;
  dekNonce: string;
  /** KEK rotation id. Not the envelope format. */
  kekVersion: string;
  /** AES-GCM format. "2" binds companyId. Omitted seals treat kekVersion "2" as format 2. */
  envelopeVersion?: string;
}

function envelopeFormat(kekVersion: string, envelopeVersion?: string): string {
  if (envelopeVersion != null && envelopeVersion !== "") return envelopeVersion;
  return kekVersion === "2" ? "2" : "1";
}

/**
 * Encrypt an API key under a fresh DEK, and the DEK under the KEK.
 * Format "1" has no additional data. Format "2" binds companyId so the
 * ciphertext cannot be moved to another tenant. Decision 0063 and 0064.
 * The 4-argument form still treats kekVersion "2" as format 2.
 */
export async function sealApiKey(
  apiKey: string,
  kek: Uint8Array,
  kekVersion: string,
  companyId?: string,
  envelopeVersion?: string,
): Promise<Envelope> {
  const format = envelopeFormat(kekVersion, envelopeVersion);
  const aad = format === "2" ? te.encode(companyId ?? "") : undefined;
  if (format === "2" && !companyId) throw new Error("version 2 seals bind a company");
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const sealedKey = await aesGcmEncrypt(dek, te.encode(apiKey), aad);
  const sealedDek = await aesGcmEncrypt(kek, dek, aad);
  return {
    keyCiphertext: bytesToHex(sealedKey.ciphertext),
    keyNonce: bytesToHex(sealedKey.nonce),
    dekCiphertext: bytesToHex(sealedDek.ciphertext),
    dekNonce: bytesToHex(sealedDek.nonce),
    kekVersion,
    envelopeVersion: format,
  };
}

export async function openApiKey(envelope: Envelope, kek: Uint8Array, companyId?: string): Promise<string> {
  const format = envelopeFormat(envelope.kekVersion, envelope.envelopeVersion);
  const aad = format === "2" ? te.encode(companyId ?? "") : undefined;
  const dek = await aesGcmDecrypt(kek, hexToBytes(envelope.dekCiphertext), hexToBytes(envelope.dekNonce), aad);
  const plain = await aesGcmDecrypt(dek, hexToBytes(envelope.keyCiphertext), hexToBytes(envelope.keyNonce), aad);
  return td.decode(plain);
}
