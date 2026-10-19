/**
 * The Content-Security-Policy for the app (decision 0192). app/public/_headers holds a
 * placeholder; the build writes the policy into dist/_headers with the sha256 of every
 * inline script in the built index.html and the Supabase origin from VITE_SUPABASE_URL.
 */
import { createHash } from "node:crypto";

export const CSP_PLACEHOLDER = "__FLOW_CSP__";

/**
 * The text of each inline <script> (one without src), exactly as the browser hashes it.
 * @param {string} html
 * @returns {string[]}
 */
export function inlineScripts(html) {
  const found = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    found.push(match[2]);
  }
  return found;
}

/**
 * @param {string} source
 * @returns {string} a CSP source expression, 'sha256-...'
 */
export function scriptHash(source) {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

/**
 * The https origin of the Supabase project, or null when the build has none (reviewers-only).
 * @param {string | undefined} url
 * @returns {string | null}
 */
export function supabaseOrigin(url) {
  const value = (url ?? "").trim();
  if (value === "") return null;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error(`VITE_SUPABASE_URL must be https: ${parsed.origin}`);
  }
  return parsed.origin;
}

/**
 * @param {{ html: string, supabaseUrl?: string }} input
 * @returns {string}
 */
export function buildCsp({ html, supabaseUrl }) {
  const hashes = inlineScripts(html).map(scriptHash);
  const origin = supabaseOrigin(supabaseUrl);
  // REST, RPC, auth and /functions/v1 share the project origin. Realtime is not bundled
  // (vite.config.ts aliases @supabase/realtime-js away), so no wss: source.
  const directives = [
    ["default-src", "'self'"],
    ["script-src", "'self'", ...hashes],
    // vaul and react-remove-scroll insert <style> elements with computed values at runtime.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'"],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...(origin ? [origin] : [])],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  return directives.map((parts) => parts.join(" ")).join("; ");
}

/**
 * Puts the policy in place of the one placeholder. Throws when the placeholder is missing or repeated.
 * @param {string} headers
 * @param {string} csp
 * @returns {string}
 */
export function fillCsp(headers, csp) {
  const count = headers.split(CSP_PLACEHOLDER).length - 1;
  if (count !== 1) throw new Error(`_headers must hold ${CSP_PLACEHOLDER} exactly once, found ${count}`);
  return headers.replace(CSP_PLACEHOLDER, csp);
}

/**
 * The headers each path pattern in a Cloudflare Pages _headers file sets.
 * @param {string} text
 * @returns {Map<string, Map<string, string>>}
 */
export function parseHeaders(text) {
  /** @type {Map<string, Map<string, string>>} */
  const rules = new Map();
  /** @type {Map<string, string> | null} */
  let current = null;
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = rules.get(line.trim()) ?? new Map();
      rules.set(line.trim(), current);
      continue;
    }
    if (!current) throw new Error(`header outside a path rule: ${line.trim()}`);
    const colon = line.indexOf(":");
    current.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return rules;
}
