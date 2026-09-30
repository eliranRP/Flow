/**
 * Checks the hosted session-pooler URL without printing it.
 * CD refuses to connect when the shape is wrong.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
const EXPECTED_USER = "postgres.sxqpnetmtufkzowutduq";
const EXPECTED_HOST = "aws-0-eu-central-1.pooler.supabase.com";

/**
 * @param {string} raw
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkSessionPoolerUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "SUPABASE_DB_URL is empty" };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "SUPABASE_DB_URL is not a URL" };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return { ok: false, reason: "SUPABASE_DB_URL must use the postgresql scheme" };
  }
  if (decodeURIComponent(url.username) !== EXPECTED_USER) {
    return { ok: false, reason: "SUPABASE_DB_URL user must be the session-pooler role for project sxqpnetmtufkzowutduq" };
  }
  if (url.hostname !== EXPECTED_HOST) {
    return { ok: false, reason: "SUPABASE_DB_URL host must be the eu-central-1 session pooler" };
  }
  if (url.port !== "5432") {
    return { ok: false, reason: "SUPABASE_DB_URL port must be 5432 (session pooler, not the transaction pooler)" };
  }
  if (url.pathname !== "/postgres") {
    return { ok: false, reason: "SUPABASE_DB_URL database must be postgres" };
  }
  if (url.searchParams.get("sslmode") !== "require") {
    return { ok: false, reason: "SUPABASE_DB_URL must set sslmode=require" };
  }
  if (url.password.length === 0) {
    return { ok: false, reason: "SUPABASE_DB_URL is missing a password" };
  }
  return { ok: true };
}

const HOSTED_REF = "sxqpnetmtufkzowutduq";

/**
 * Loopback database for the CI preflight. It is not the hosted pooler.
 * @param {string} raw
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkLocalPreflightUrl(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "SUPABASE_DB_URL is empty" };
  }
  if (raw.includes(HOSTED_REF)) {
    return { ok: false, reason: "local preflight refuses the hosted project" };
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "SUPABASE_DB_URL is not a URL" };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return { ok: false, reason: "SUPABASE_DB_URL must use the postgresql scheme" };
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return { ok: false, reason: "local preflight host must be loopback" };
  }
  if (url.port !== "54322") {
    return { ok: false, reason: "local preflight port must be 54322" };
  }
  if (decodeURIComponent(url.username) !== "postgres") {
    return { ok: false, reason: "local preflight user must be postgres" };
  }
  if (url.pathname !== "/postgres") {
    return { ok: false, reason: "local preflight database must be postgres" };
  }
  if (url.password.length === 0) {
    return { ok: false, reason: "SUPABASE_DB_URL is missing a password" };
  }
  return { ok: true };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const local = process.argv.includes("--local");
  const result = local
    ? checkLocalPreflightUrl(process.env.SUPABASE_DB_URL ?? "")
    : checkSessionPoolerUrl(process.env.SUPABASE_DB_URL ?? "");
  if (!result.ok) {
    console.error(result.reason);
    console.error("Refusing to open a database connection.");
    process.exit(1);
  }
}
