// FLOW-502: Web Push without a library. VAPID (RFC 8292) signs an ES256 JWT for the push
// service; the payload is encrypted for the browser with aes128gcm (RFC 8291, RFC 8188).
// Only WebCrypto is used, so the edge runtime needs no npm package.

export interface VapidKeys {
  /** Uncompressed P-256 public key (65 bytes), base64url. The app reads the same value. */
  publicKey: string;
  /** P-256 private scalar (32 bytes), base64url. An edge function secret, never in the repo. */
  privateKey: string;
  /** mailto: or https: contact for the push service. */
  subject: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome = "sent" | "gone" | "failed";

/** The push services browsers use. The send function posts only to these hosts. */
export const PUSH_ENDPOINT = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\/[^\s]+$/;

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Bytes): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error("webpush_base64");
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function publicPoint(raw: Bytes): { x: string; y: string } {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error("webpush_public_key");
  return { x: base64UrlEncode(raw.slice(1, 33)), y: base64UrlEncode(raw.slice(33)) };
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8);
  return new Uint8Array(bits);
}

/** The Authorization header value: `vapid t=<jwt>, k=<public key>`. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now: Date): Promise<string> {
  const audience = new URL(endpoint).origin;
  const point = publicPoint(base64UrlDecode(keys.publicKey));
  const signingKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: point.x, y: point.y, d: keys.privateKey, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(encoder.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
    sub: keys.subject,
  })));
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(unsigned));
  return `vapid t=${unsigned}.${base64UrlEncode(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

/**
 * One aes128gcm record for the browser's p256dh and auth secret. `ephemeral` and `salt` are for
 * tests; a send always uses fresh ones.
 */
export async function encryptPush(
  plaintext: Bytes,
  target: Pick<PushTarget, "p256dh" | "auth">,
  options: { ephemeral?: CryptoKeyPair; salt?: Bytes } = {},
): Promise<Bytes> {
  const receiverRaw = base64UrlDecode(target.p256dh);
  publicPoint(receiverRaw);
  const authSecret = base64UrlDecode(target.auth);
  if (authSecret.length !== 16) throw new Error("webpush_auth");
  // 4096-byte records; one record holds the payload plus its delimiter and the 16-byte tag.
  if (plaintext.length > 3993) throw new Error("webpush_too_long");

  const ephemeral = options.ephemeral ?? await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  ) as CryptoKeyPair;
  const senderRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const receiver = await crypto.subtle.importKey("raw", receiverRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: receiver }, ephemeral.privateKey, 256));

  const keyInfo = concat(encoder.encode("WebPush: info\0"), receiverRaw, senderRaw);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(plaintext, new Uint8Array([2]));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  const recordSize = new Uint8Array([0, 0, 0x10, 0]);
  return concat(salt, recordSize, new Uint8Array([senderRaw.length]), senderRaw, sealed);
}

/** Posts one notification. 404 and 410 mean the browser dropped the subscription. */
export async function sendPush(
  fetchImpl: typeof fetch,
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  now: Date,
  ttlSeconds = 4 * 60 * 60,
): Promise<PushOutcome> {
  if (!PUSH_ENDPOINT.test(target.endpoint) || target.endpoint.length > 2048) return "gone";
  let body: Bytes;
  let authorization: string;
  try {
    body = await encryptPush(encoder.encode(JSON.stringify(payload)), target);
    authorization = await vapidAuthorization(target.endpoint, keys, now);
  } catch {
    return "failed";
  }
  let response: Response;
  try {
    response = await fetchImpl(target.endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        authorization,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(ttlSeconds),
        urgency: "normal",
      },
      body,
    });
  } catch {
    return "failed";
  }
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) return "gone";
  return response.ok ? "sent" : "failed";
}
