import { MERCURY_GET_ALLOWLIST } from "./allowlist.ts";

const TRANSACTION = /^\/transaction\/[^/]+$/;
const TREASURY_TRANSACTIONS = /^\/treasury\/[A-Za-z0-9-]{1,128}\/transactions$/;

function allowed(path: string): boolean {
  if (path.startsWith("/") === false || path.includes("://") || path.includes("?") || path.includes("..")) {
    return false;
  }
  if (TRANSACTION.test(path) || TREASURY_TRANSACTIONS.test(path)) return true;
  return (MERCURY_GET_ALLOWLIST as readonly string[]).includes(path);
}

/** Refuse anything except GET on the allowlist. The fetch wrapper calls this first. */
export function assertMercuryGet(method: string, path: string): void {
  if (method !== "GET") {
    throw new Error("mercury_method");
  }
  if (!allowed(path)) {
    throw new Error("mercury_path");
  }
}
