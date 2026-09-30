import { pathToFileURL } from "node:url";

/**
 * Signing-key spike for decision 0080.
 * This does not run in CI. It talks to the hosted project when you set the env.
 * If the only trusted key is Auth's in-use key, it stops. It never sets FLOW_JWT_LEGACY.
 */

/**
 * @param {string[]} jwksKids
 * @param {string | undefined} signingKid
 */
export function criterion1(jwksKids, signingKid) {
  if (!signingKid) {
    return {
      ok: false,
      stop: true,
      message: "spike stopped: no additional signing key. Refusing to sign with Auth's in-use key. Do not set FLOW_JWT_LEGACY.",
    };
  }
  if (!jwksKids.includes(signingKid)) {
    return {
      ok: false,
      stop: true,
      message: "spike stopped: the signing key is not in the project JWKS. Do not set FLOW_JWT_LEGACY.",
    };
  }
  if (jwksKids.length < 2) {
    return {
      ok: false,
      stop: true,
      message: "spike stopped: the JWKS has only one key, so this key is Auth's in-use key. Do not set FLOW_JWT_LEGACY.",
    };
  }
  return { ok: true, stop: false, message: "criterion 1 passed: an additional signing key is in the JWKS" };
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

async function main() {
  const project = process.env.FLOW_SPIKE_URL ?? "https://sxqpnetmtufkzowutduq.supabase.co";
  const jwks = await fetch(`${project}/auth/v1/.well-known/jwks.json`).then((response) => response.json());
  const kids = (jwks.keys ?? []).map((key) => key.kid).filter((kid) => typeof kid === "string");
  let signingKid;
  if (process.env.FLOW_MCP_SIGNING_KEY) {
    signingKid = JSON.parse(process.env.FLOW_MCP_SIGNING_KEY).kid;
  }
  const first = criterion1(kids, signingKid);
  console.log(first.message);
  console.log(`JWKS kids: ${kids.join(", ") || "(none)"}`);
  if (!first.ok) process.exit(2);

  const functionUrl = `${project}/functions/v1/flow-mcp`;
  const response = await fetch(functionUrl, { method: "GET" });
  const header = response.headers.get("x-flow-cf-connecting-ip");
  const fourth = criterion4(header);
  console.log(fourth.message);
  if (!fourth.ok) process.exit(4);
  console.log("spike passed criteria 1 and 4. PostgREST acceptance still requires SPIKE_USER_ID and a standby key that is not rotated into use.");
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "spike failed");
    process.exit(1);
  });
}
