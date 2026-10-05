// flow-mcp. Stateless MCP 2025-06-18, plus mint, revoke, and status.
// Decision 0080. Reads and the three single-expense writes. verify_jwt is false.
// The signed pass uses the credential row. The signing key has no user identity.

import { corsHeadersFor } from "../_shared/http.ts";
import { callTool, isWriteTool, READ_TOOL_NAMES, toolsFor } from "./tools.ts";
import { signUserJwt, type SigningKey } from "./sign.ts";

const PRODUCTION_ORIGIN = "https://flow-app-dx5.pages.dev";
const PROTOCOL = "2025-06-18";
const MAX_BODY_BYTES = 65_536;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type Deps = {
  env: (name: string) => string | undefined;
  fetch: FetchLike;
};

const defaultDeps: Deps = {
  env: (name) => Deno.env.get(name),
  fetch: (input, init) => fetch(input, init),
};

type Route = "mcp" | "mint" | "revoke" | "status";

function routeOf(url: URL): Route {
  const parts = url.pathname.split("/").filter((part) => part.length > 0);
  const last = parts[parts.length - 1] ?? "";
  if (last === "mint" || last === "revoke" || last === "status") return last;
  return "mcp";
}

function cfState(req: Request): "present" | "absent" {
  const value = req.headers.get("cf-connecting-ip");
  if (value == null || value.trim() === "") return "absent";
  return "present";
}

function clientIp(req: Request): string | null {
  const value = req.headers.get("cf-connecting-ip");
  if (value == null || value.trim() === "") return null;
  return value.trim();
}

function methodNotAllowed(req: Request, route: Route): Response {
  const allow = route === "mcp" ? "POST" : "POST, OPTIONS";
  return jsonResponse(req, { error: "method" }, 405, { allow });
}

function jsonResponse(req: Request, body: unknown, status: number, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("content-type", "application/json");
  headers.set("x-flow-cf-connecting-ip", cfState(req));
  return new Response(JSON.stringify(body), { status, headers });
}

function emptyResponse(req: Request, status: number, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("x-flow-cf-connecting-ip", cfState(req));
  return new Response(null, { status, headers });
}

function cors(origin: string): HeadersInit {
  return {
    ...corsHeadersFor(origin),
    vary: "Origin",
  };
}

function readJsonKey(raw: string | undefined, field: string): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed[field];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function secretKey(deps: Deps): string {
  return readJsonKey(deps.env("SUPABASE_SECRET_KEYS"), "default");
}

function appOrigins(deps: Deps): Set<string> {
  const raw = deps.env("FLOW_MCP_APP_ORIGINS");
  if (raw == null || raw.trim() === "") return new Set([PRODUCTION_ORIGIN]);
  return new Set(raw.split(",").map((item) => item.trim()).filter((item) => item.length > 0));
}

function publishableKey(deps: Deps): string {
  const fromDictionary = readJsonKey(deps.env("SUPABASE_PUBLISHABLE_KEYS"), "default");
  if (fromDictionary) return fromDictionary;
  return deps.env("SUPABASE_ANON_KEY") ?? "";
}

function signingKey(deps: Deps): SigningKey | null {
  const raw = deps.env("FLOW_MCP_SIGNING_KEY");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SigningKey>;
    if (parsed.kty !== "EC" || parsed.crv !== "P-256") return null;
    if (typeof parsed.kid !== "string" || typeof parsed.d !== "string") return null;
    if (typeof parsed.x !== "string" || typeof parsed.y !== "string") return null;
    return { kty: "EC", crv: "P-256", alg: "ES256", kid: parsed.kid, d: parsed.d, x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

type Pepper = { kid: string; bytes: Uint8Array };

const PEPPER_TOKEN = /^[A-Za-z0-9_-]+$/;

function pepperEntry(value: unknown): Pepper | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return null;
  const kid = (value as { kid?: unknown }).kid;
  const secret = (value as { secret?: unknown }).secret;
  if (typeof kid !== "string" || !PEPPER_TOKEN.test(kid) || kid.length > 64) return null;
  if (typeof secret !== "string" || !PEPPER_TOKEN.test(secret) || new TextEncoder().encode(secret).byteLength < 32) {
    return null;
  }
  return { kid, bytes: new TextEncoder().encode(secret) };
}

/** Current pepper first, then previous kids. A rotation keeps old tokens working. */
function peppersOf(raw: string | undefined): Pepper[] | null {
  if (raw == null || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const current = pepperEntry(parsed);
  if (!current) return null;
  const previousRaw = (parsed as { previous?: unknown }).previous;
  const previous = previousRaw == null ? [] : previousRaw;
  if (!Array.isArray(previous)) return null;
  const all = [current];
  const kids = new Set([current.kid]);
  for (const item of previous) {
    const entry = pepperEntry(item);
    if (!entry || kids.has(entry.kid)) return null;
    kids.add(entry.kid);
    all.push(entry);
  }
  return all;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function hmacSecret(secret: string, pepper: Uint8Array): Promise<string> {
  const raw = new Uint8Array(pepper.byteLength);
  raw.set(pepper);
  const key = await crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(secret));
  return base64url(new Uint8Array(signature));
}

function mintSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `flow_mcp_${base64url(bytes)}`;
}

async function rpc(deps: Deps, name: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const url = deps.env("SUPABASE_URL") ?? "";
  const key = secretKey(deps);
  const response = await deps.fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: "The write was refused." };
    }
  }
  return { status: response.status, json };
}

async function userRpc(deps: Deps, jwt: string, name: string, body: Record<string, unknown>): Promise<{ status: number; json: unknown }> {
  const url = deps.env("SUPABASE_URL") ?? "";
  const key = publishableKey(deps);
  const response = await deps.fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

async function getUserId(deps: Deps, jwt: string): Promise<string | null> {
  const url = deps.env("SUPABASE_URL") ?? "";
  const key = publishableKey(deps);
  if (!url || !key || !jwt) return null;
  const response = await deps.fetch(`${url}/auth/v1/user`, {
    method: "GET",
    headers: { apikey: key, authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (body == null || typeof body !== "object" || Array.isArray(body)) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function bearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? "";
}

function appOrigin(req: Request, deps: Deps): string | null {
  const origin = req.headers.get("origin");
  if (origin == null) return null;
  return appOrigins(deps).has(origin) ? origin : null;
}

async function noteFailure(deps: Deps, req: Request): Promise<{ throttled: boolean; retry: number }> {
  const address = clientIp(req);
  if (!address) return { throttled: false, retry: 0 };
  const result = await rpc(deps, "note_auth_failure", { p_address: address });
  const body = result.json as { throttled?: unknown; retry_after_seconds?: unknown } | null;
  return {
    throttled: body?.throttled === true,
    retry: typeof body?.retry_after_seconds === "number" ? body.retry_after_seconds : 1,
  };
}

function unauthorized(req: Request, throttled: { throttled: boolean; retry: number }): Response {
  if (throttled.throttled) {
    return jsonResponse(req, { error: "rate_limited", retry_after_seconds: throttled.retry }, 429, {
      "retry-after": String(throttled.retry),
    });
  }
  return jsonResponse(req, { error: "unauthorized" }, 401);
}

function scopeList(choice: unknown): string[] | null {
  if (choice == null || choice === "read_write") return ["read", "write"];
  if (choice === "read") return ["read"];
  return null;
}

function declaredLength(req: Request): number | null {
  const raw = req.headers.get("content-length");
  if (raw == null || !/^\d+$/.test(raw.trim())) return null;
  const size = Number(raw);
  return Number.isSafeInteger(size) ? size : null;
}

/** Read at most MAX_BODY_BYTES. A larger body is refused and the rest is not kept. */
async function cappedText(req: Request): Promise<string | "too_large"> {
  const declared = declaredLength(req);
  if (declared != null && declared > MAX_BODY_BYTES) return "too_large";
  if (req.body == null) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    const value = next.value;
    if (value == null || value.byteLength === 0) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readBody(req: Request): Promise<Record<string, unknown> | null | "too_large"> {
  const text = await cappedText(req);
  if (text === "too_large") return "too_large";
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed) || parsed == null || typeof parsed !== "object") return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function handleMint(req: Request, deps: Deps, userId: string): Promise<Response> {
  const body = await readBody(req);
  if (body === "too_large" || body == null) return jsonResponse(req, { error: "validation" }, 400);
  const scope = scopeList(body.scope);
  if (!scope) return jsonResponse(req, { error: "validation" }, 400);
  const peppers = peppersOf(deps.env("FLOW_MCP_PEPPER"));
  const pepper = peppers?.[0];
  if (!pepper) return jsonResponse(req, { error: "server is missing a secret" }, 500);
  const secret = mintSecret();
  const tokenHash = await hmacSecret(secret, pepper.bytes);
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const stored = await rpc(deps, "store_mcp_credential", {
    p_user: userId,
    p_token_hash: tokenHash,
    p_scope: scope,
    p_pepper_kid: pepper.kid,
    p_expires_at: expires,
  });
  if (stored.status >= 400) {
    const message = (stored.json as { message?: unknown } | null)?.message;
    if (message === "no company") return jsonResponse(req, { error: "no company" }, 400);
    return jsonResponse(req, { error: "could not store the credential" }, 500);
  }
  return jsonResponse(req, { id: stored.json, secret, scope, expires_at: expires }, 200);
}

async function handleRevoke(req: Request, deps: Deps, userId: string): Promise<Response> {
  const body = await readBody(req);
  if (body === "too_large") return jsonResponse(req, { error: "validation" }, 400);
  const id = body && typeof body.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse(req, { error: "validation" }, 400);
  const result = await rpc(deps, "revoke_mcp_credential", { p_user: userId, p_id: id });
  const payload = result.json as { ok?: unknown; error?: unknown } | null;
  if (payload?.error === "not_found" || payload?.ok === false) {
    return jsonResponse(req, { error: "not_found" }, 404);
  }
  if (result.status >= 400) return jsonResponse(req, { error: "could not revoke the credential" }, 500);
  return jsonResponse(req, { ok: true }, 200);
}

async function handleStatus(deps: Deps, req: Request, userId: string): Promise<Response> {
  const result = await rpc(deps, "mcp_credential_status", { p_user: userId });
  if (result.status >= 400) return jsonResponse(req, { error: "could not read the credential" }, 500);
  return jsonResponse(req, result.json, 200);
}

async function handleMcp(req: Request, deps: Deps): Promise<Response> {
  const token = bearer(req);
  if (!token.startsWith("flow_mcp_")) return unauthorized(req, await noteFailure(deps, req));
  const peppers = peppersOf(deps.env("FLOW_MCP_PEPPER"));
  if (!peppers) return jsonResponse(req, { error: "server is missing a secret" }, 500);
  let row: {
    found?: unknown;
    id?: unknown;
    user_id?: unknown;
    company_id?: unknown;
    scope?: unknown;
    expires_at?: unknown;
    revoked_at?: unknown;
  } | null = null;
  for (const pepper of peppers) {
    const tokenHash = await hmacSecret(token, pepper.bytes);
    const found = await rpc(deps, "lookup_mcp_credential", {
      p_token_hash: tokenHash,
      p_pepper_kid: pepper.kid,
    });
    if (found.status >= 400) return jsonResponse(req, { error: "could not read the credential" }, 500);
    const candidate = found.json as {
      found?: unknown;
      id?: unknown;
      user_id?: unknown;
      company_id?: unknown;
      scope?: unknown;
      expires_at?: unknown;
      revoked_at?: unknown;
    } | null;
    if (candidate?.found === true) {
      row = candidate;
      break;
    }
  }
  const expired = typeof row?.expires_at === "string" && Date.parse(row.expires_at) <= Date.now();
  if (row?.found !== true || row.revoked_at != null || expired || typeof row.id !== "string") {
    return unauthorized(req, await noteFailure(deps, req));
  }
  // The size cap is the header and the capped read. An over-cap request is
  // refused before the rate limit. The tool name is in the body, so the
  // bucket is chosen from that capped text, and the limit runs before the
  // call is signed or handled.
  const declared = declaredLength(req);
  if (declared != null && declared > MAX_BODY_BYTES) {
    return jsonResponse(req, { error: "validation" }, 400);
  }
  const text = await cappedText(req);
  if (text === "too_large") return jsonResponse(req, { error: "validation" }, 400);
  let body: Record<string, unknown> | null = {};
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed) || parsed == null || typeof parsed !== "object") body = null;
      else body = parsed as Record<string, unknown>;
    } catch {
      body = null;
    }
  }
  const method = body && typeof body.method === "string" ? body.method : "";
  const params = body?.params;
  const record = params != null && typeof params === "object" && !Array.isArray(params)
    ? params as Record<string, unknown>
    : null;
  const toolName = method === "tools/call" && typeof record?.name === "string" ? record.name : "";
  const limited = await rpc(deps, "bump_mcp_rate", {
    p_token: row.id,
    p_user: row.user_id,
    p_kind: isWriteTool(toolName) ? "write" : "read",
  });
  const limit = limited.json as { allowed?: unknown; retry_after_seconds?: unknown } | null;
  if (limited.status >= 400 || typeof limit?.allowed !== "boolean") {
    return jsonResponse(req, { error: "unavailable" }, 503);
  }
  if (limit.allowed !== true) {
    const retry = typeof limit.retry_after_seconds === "number" ? limit.retry_after_seconds : 1;
    return jsonResponse(req, { error: "rate_limited", retry_after_seconds: retry }, 429, {
      "retry-after": String(retry),
    });
  }
  await rpc(deps, "touch_mcp_credential", { p_id: row.id });

  const version = req.headers.get("mcp-protocol-version");
  if (version != null && version !== PROTOCOL) {
    return jsonResponse(req, { error: "unsupported protocol" }, 400);
  }
  if (body == null) return jsonResponse(req, { error: "one message per request" }, 400);
  if (method.startsWith("notifications/")) return emptyResponse(req, 202);
  const id = "id" in body ? body.id : null;
  if (method === "initialize") {
    return jsonResponse(req, {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "flow-mcp", version: "0.1.0" },
      },
    }, 200);
  }
  if (method === "ping") return jsonResponse(req, { jsonrpc: "2.0", id, result: {} }, 200);
  const scope = Array.isArray(row.scope) ? row.scope.filter((item): item is string => typeof item === "string") : [];
  if (method === "tools/list") {
    const tools = signingKey(deps) ? toolsFor(scope) : [];
    return jsonResponse(req, { jsonrpc: "2.0", id, result: { tools } }, 200);
  }
  if (method === "tools/call") {
    const name = toolName;
    const toolError = (code: string, message: string) => {
      const structured = { ok: false, error: { code, message } };
      return jsonResponse(req, {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(structured) }],
          structuredContent: structured,
          isError: true,
        },
      }, 200);
    };
    const knownRead = (READ_TOOL_NAMES as readonly string[]).includes(name);
    if (isWriteTool(name)) {
      if (!scope.includes("write")) return toolError("forbidden", "forbidden");
    } else if (knownRead && !scope.includes("read")) {
      return toolError("forbidden", "forbidden");
    }
    const key = signingKey(deps);
    if (!key) return toolError("unavailable", "unavailable");
    const userId = typeof row.user_id === "string" ? row.user_id : "";
    const companyId = typeof row.company_id === "string" ? row.company_id : "";
    if (!userId || !companyId) return jsonResponse(req, { error: "unavailable" }, 503);
    const signed = await signUserJwt(key, {
      issuer: `${deps.env("SUPABASE_URL") ?? ""}/auth/v1`,
      sub: userId,
      companyId,
      scope,
      mcpTid: row.id,
      jti: crypto.randomUUID(),
      now: Math.floor(Date.now() / 1000),
    });
    const result = await callTool(name, record?.arguments, scope, (rpcName, rpcBody) => userRpc(deps, signed, rpcName, rpcBody));
    const text = JSON.stringify(result.structuredContent);
    return jsonResponse(req, {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text }],
        structuredContent: result.structuredContent,
        isError: result.isError,
      },
    }, 200);
  }
  return jsonResponse(req, { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }, 200);
}

export async function handle(req: Request, deps: Deps = defaultDeps): Promise<Response> {
  const url = new URL(req.url);
  const route = routeOf(url);
  if (req.method === "GET") return finish(route, methodNotAllowed(req, route));
  if (req.method === "OPTIONS") {
    if (route === "mcp") return methodNotAllowed(req, route);
    const origin = appOrigin(req, deps);
    if (!origin) return jsonResponse(req, { error: "origin" }, 403);
    return finish(route, emptyResponse(req, 204, cors(origin)));
  }
  if (req.method !== "POST") return finish(route, methodNotAllowed(req, route));

  if (route === "mcp") {
    if (req.headers.get("origin") != null) return jsonResponse(req, { error: "origin" }, 403);
    return handleMcp(req, deps);
  }

  const origin = appOrigin(req, deps);
  if (!origin) return jsonResponse(req, { error: "origin" }, 403);
  const userId = await getUserId(deps, bearer(req));
  if (!userId) return finish(route, jsonResponse(req, { error: "unauthorized" }, 401, cors(origin)));
  if (route === "mint") {
    const response = await handleMint(req, deps, userId);
    return finish(route, withCors(response, origin));
  }
  if (route === "revoke") {
    const response = await handleRevoke(req, deps, userId);
    return withCors(response, origin);
  }
  const response = await handleStatus(deps, req, userId);
  return withCors(response, origin);
}

function withCors(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors(origin))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function finish(route: Route, response: Response): Response {
  if (route !== "mint") return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}

