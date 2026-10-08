// Signs the 60-second user JWT for PostgREST. Decision 0080.
// The key is an additional asymmetric key, never Auth's in-use session key.
// There is no FLOW_JWT_LEGACY fallback in this file.

export type SigningKey = {
  kty: "EC";
  crv: "P-256";
  alg?: "ES256";
  kid: string;
  d: string;
  x: string;
  y: string;
};

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(text);
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy;
}

export async function signUserJwt(key: SigningKey, input: {
  issuer: string;
  sub: string;
  companyId: string;
  scope: string[];
  mcpTid: string;
  jti: string;
  now: number;
}): Promise<string> {
  // The key is shared server config. sub, company, and scope come from the caller,
  // which must pass the credential row. Fields on the key are not copied in.
  const header = { alg: "ES256", kid: key.kid, typ: "JWT" };
  const payload = {
    iss: input.issuer,
    sub: input.sub,
    role: "authenticated",
    aud: "authenticated",
    company_id: input.companyId,
    scope: input.scope,
    iat: input.now,
    exp: input.now + 60,
    jti: input.jti,
    mcp_tid: input.mcpTid,
  };
  const signingInput = `${base64url(bytesOf(JSON.stringify(header)))}.${base64url(bytesOf(JSON.stringify(payload)))}`;
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    bytesOf(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

export { decodeJwtPart } from "../_shared/jwt.ts";
