#!/usr/bin/env node
// Validate cycle 1 deploy secrets before a migration or a Pages publish.
// Prints no secret values.
import { pathToFileURL } from "node:url";

const SCOPED_TOKEN = /^sbp_fc/;
const CLASSIC_TOKEN = /^sbp_[0-9a-fA-F]{40}$/;
const PEPPER_TOKEN = /^[A-Za-z0-9_-]+$/;

/**
 * @param {unknown} value
 * @param {Set<string>} kids
 * @returns {string | null}
 */
function entryProblem(value, kids) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return "must be a JSON object with kid and secret";
  }
  const kid = /** @type {{ kid?: unknown }} */ (value).kid;
  const secret = /** @type {{ secret?: unknown }} */ (value).secret;
  if (typeof kid !== "string" || !PEPPER_TOKEN.test(kid) || kid.length > 64) return "needs a kid";
  if (kids.has(kid)) return "repeats a kid";
  if (typeof secret !== "string" || !PEPPER_TOKEN.test(secret)) {
    return "must use only letters, digits, underscore, and hyphen";
  }
  if (Buffer.byteLength(secret) < 32) return "needs a secret of at least 32 bytes";
  kids.add(kid);
  return null;
}

/**
 * @param {string | undefined} raw
 * @returns {string | null} a problem phrase, or null when the pepper is usable
 */
export function pepperProblem(raw) {
  if (raw == null || raw.trim() === "") return "is empty";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "must be JSON with a kid and a secret of at least 32 bytes";
  }
  const kids = new Set();
  const current = entryProblem(parsed, kids);
  if (current) return current;
  const previous = parsed.previous;
  if (previous == null) return null;
  if (!Array.isArray(previous)) return "previous must be an array of pepper objects";
  for (const item of previous) {
    const problem = entryProblem(item, kids);
    if (problem) return `previous ${problem}`;
  }
  return null;
}

/**
 * @param {string | undefined} token
 */
export function accessTokenProblem(token) {
  if (token == null || token.trim() === "") return "is empty";
  const value = token.trim();
  if (CLASSIC_TOKEN.test(value)) {
    return "is a classic token (40 hex characters). A classic token is not accepted";
  }
  if (!SCOPED_TOKEN.test(value)) {
    return "must be a scoped personal access token for this project. A classic token is not accepted";
  }
  return null;
}

function fail(message) {
  console.error(message);
  console.error("No migration was pushed and the hosted build was not deployed.");
  process.exit(1);
}

function main() {
  const required = [
    "SUPABASE_DB_URL",
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "SUPABASE_ACCESS_TOKEN",
    "FLOW_MCP_PEPPER",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    fail(`Deploy failed. Missing production environment secrets: ${missing.join(" ")}.`);
  }
  const token = accessTokenProblem(process.env.SUPABASE_ACCESS_TOKEN);
  if (token) fail(`Deploy failed. SUPABASE_ACCESS_TOKEN ${token}.`);
  const pepper = pepperProblem(process.env.FLOW_MCP_PEPPER);
  if (pepper) fail(`Deploy failed. FLOW_MCP_PEPPER ${pepper}.`);
}

const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invoked) main();
