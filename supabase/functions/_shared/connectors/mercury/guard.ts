import { MERCURY_GET_ALLOWLIST } from "./allowlist.ts";

// The two templated entries match one id segment: letters, digits, _ and - (FLOW-509). An
// encoded slash or dot, a second segment, or the literal {placeholder} is refused.
const TRANSACTION = /^\/transaction\/[A-Za-z0-9_-]{1,128}$/;
const TREASURY_TRANSACTIONS = /^\/treasury\/[A-Za-z0-9_-]{1,128}\/transactions$/;
const EXACT = (MERCURY_GET_ALLOWLIST as readonly string[]).filter((path) => !path.includes("{"));

function allowed(path: string): boolean {
  if (path.startsWith("/") === false || path.includes("://") || path.includes("?") || path.includes("..")) {
    return false;
  }
  if (TRANSACTION.test(path) || TREASURY_TRANSACTIONS.test(path)) return true;
  return EXACT.includes(path);
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
