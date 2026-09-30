import { pathToFileURL } from "node:url";

/**
 * Signing-key spike for decision 0080.
 * Criterion 1 reads standby status from the Management API. A JWKS key count is not the check.
 * This does not run in CI. It never prints a private key, and it never sets FLOW_JWT_LEGACY.
 */

/**
 * @param {{ status?: string, kid?: string }[]} keys
 * @param {string | undefined} signingKid
 */
export function criterion1(keys, signingKid) {
  const list = Array.isArray(keys) ? keys : [];
  const inUse = list.filter((key) => key?.status === "in_use" && typeof key.kid === "string");
  const standby = list.filter((key) => key?.status === "standby" && typeof key.kid === "string");
  if (standby.length !== 1) {
    return {
      ok: false,
      stop: true,
      needsKey: false,
      message: "spike stopped: the Management API does not report exactly one standby key. A JWKS key count is not this check. Do not set FLOW_JWT_LEGACY.",
    };
  }
  const standbyKid = standby[0].kid;
  if (inUse.some((key) => key.kid === standbyKid)) {
    return {
      ok: false,
      stop: true,
      needsKey: false,
      message: "spike stopped: the standby kid is Auth's in-use key. Do not rotate it into use. Do not set FLOW_JWT_LEGACY.",
    };
  }
  if (signingKid && signingKid !== standbyKid) {
    return {
      ok: false,
      stop: true,
      needsKey: false,
      message: "spike stopped: FLOW_MCP_SIGNING_KEY is not the standby key. Do not set FLOW_JWT_LEGACY.",
    };
  }
  if (!signingKid) {
    return {
      ok: false,
      stop: false,
      needsKey: true,
      standbyKid,
      message: "criterion 1 passed the standby status. Place the standby private key in the environment as FLOW_MCP_SIGNING_KEY to prove criterion 3. Do not rotate the key into use.",
    };
  }
  return {
    ok: true,
    stop: false,
    needsKey: false,
    standbyKid,
    message: "criterion 1 passed: the Management API reports one standby key, and it is not Auth's in-use key",
  };
}

/**
 * @param {{ ownerStatus: number, ownerCompany: string | null, otherCompany: string | null, expectedCompany: string }} input
 */
export function criterion3(input) {
  if (input.ownerStatus !== 200 || input.ownerCompany == null || input.ownerCompany !== input.expectedCompany) {
    return { ok: false, message: "criterion 3 failed: PostgREST did not accept the standby key for this user" };
  }
  if (input.otherCompany != null && input.otherCompany === input.expectedCompany) {
    return { ok: false, message: "criterion 3 failed: another user's pass returned this company" };
  }
  return { ok: true, message: "criterion 3 passed: PostgREST accepted the standby key, and the other user did not see this company" };
}

/**
 * Criterion 4. A missing header is a failure, not a pass.
 * @param {string | null | undefined} header
 */
export function criterion4(header) {
  if (header == null || header.trim() === "" || header === "absent") {
    return { ok: false, message: "criterion 4 failed: cf-connecting-ip did not reach the function" };
  }
  return { ok: true, message: "criterion 4 passed: cf-connecting-ip reached the function" };
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function signProbe(key, input) {
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
  const signingInput = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(Buffer.from(JSON.stringify(payload)))}`;
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", alg: "ES256", kid: key.kid, d: key.d, x: key.x, y: key.y },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

async function dashboard(project, publishable, jwt) {
  const response = await fetch(`${project}/rest/v1/rpc/get_dashboard`, {
    method: "POST",
    headers: {
      apikey: publishable,
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ p_from: null, p_to: null, p_basis: "cash" }),
  });
  const json = await response.json().catch(() => null);
  const company = json && typeof json.company_id === "string" ? json.company_id : null;
  return { status: response.status, company };
}

async function main() {
  const ref = "sxqpnetmtufkzowutduq";
  const project = process.env.FLOW_SPIKE_URL ?? `https://${ref}.supabase.co`;
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    console.error("Set SUPABASE_ACCESS_TOKEN in the environment. The spike does not print it.");
    process.exit(2);
  }
  const listed = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth/signing-keys`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!listed.ok) {
    console.error(`Management API status ${listed.status}. The spike stopped before criterion 3.`);
    process.exit(2);
  }
  const payload = await listed.json();
  const raw = Array.isArray(payload) ? payload : [];
  const keys = raw.map((key) => ({
    status: typeof key.status === "string" ? key.status : "",
    kid: typeof key.public_jwk?.kid === "string" ? key.public_jwk.kid : typeof key.id === "string" ? key.id : "",
  }));
  let signingKid;
  if (process.env.FLOW_MCP_SIGNING_KEY) signingKid = JSON.parse(process.env.FLOW_MCP_SIGNING_KEY).kid;
  const first = criterion1(keys, signingKid);
  console.log(first.message);
  if (!first.ok) process.exit(first.needsKey ? 4 : 2);

  const owner = process.env.FLOW_MCP_SPIKE_USER;
  const other = process.env.FLOW_MCP_SPIKE_OTHER;
  const company = process.env.FLOW_MCP_SPIKE_COMPANY;
  const publishable = process.env.FLOW_SPIKE_PUBLISHABLE_KEY;
  if (!owner || !other || !company || !publishable) {
    console.error("Criterion 3 needs FLOW_MCP_SPIKE_USER, FLOW_MCP_SPIKE_OTHER, FLOW_MCP_SPIKE_COMPANY, and FLOW_SPIKE_PUBLISHABLE_KEY. The spike did not call PostgREST.");
    process.exit(4);
  }
  const key = JSON.parse(process.env.FLOW_MCP_SIGNING_KEY);
  const now = Math.floor(Date.now() / 1000);
  const ownerJwt = await signProbe(key, {
    issuer: `${project}/auth/v1`,
    sub: owner,
    companyId: company,
    scope: ["read"],
    mcpTid: "spike-owner",
    jti: crypto.randomUUID(),
    now,
  });
  const otherJwt = await signProbe(key, {
    issuer: `${project}/auth/v1`,
    sub: other,
    companyId: "other",
    scope: ["read"],
    mcpTid: "spike-other",
    jti: crypto.randomUUID(),
    now,
  });
  const ownerCall = await dashboard(project, publishable, ownerJwt);
  const otherCall = await dashboard(project, publishable, otherJwt);
  const third = criterion3({
    ownerStatus: ownerCall.status,
    ownerCompany: ownerCall.company,
    otherCompany: otherCall.company,
    expectedCompany: company,
  });
  console.log(third.message);
  if (!third.ok) {
    console.error("Standby was not accepted. The fallback is the function secret FLOW_JWT_LEGACY, set in the Supabase dashboard only, never in GitHub. This spike did not set it.");
    process.exit(3);
  }

  const functionUrl = `${project}/functions/v1/flow-mcp`;
  const response = await fetch(functionUrl, { method: "GET" });
  const header = response.headers.get("x-flow-cf-connecting-ip");
  const fourth = criterion4(header);
  console.log(fourth.message);
  if (!fourth.ok) process.exit(4);
  console.log("spike passed. Do not rotate the standby key into use.");
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "spike failed");
    process.exit(1);
  });
}
