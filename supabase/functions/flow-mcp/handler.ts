// flow-mcp cycle 1. Stateless MCP 2025-06-18, plus mint, revoke, and status.
// Decision 0080. No ledger tools. tools/list is empty. verify_jwt is false.

const APP_ORIGINS = new Set([
  "http://127.0.0.1:43123",
  "http://localhost:43123",
  "https://flow-app-dx5.pages.dev",
]);

const PROTOCOL = "2025-06-18";

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
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-allow-methods": "POST, OPTIONS",
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
  const fromDictionary = readJsonKey(deps.env("SUPABASE_SECRET_KEYS"), "default");
  if (fromDictionary) return fromDictionary;
  return deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function publishableKey(deps: Deps): string {
  const fromDictionary = readJsonKey(deps.env("SUPABASE_PUBLISHABLE_KEYS"), "default");
  if (fromDictionary) return fromDictionary;
  return deps.env("SUPABASE_ANON_KEY") ?? "";
}

function pepperBytes(deps: Deps): Uint8Array | null {
  const raw = deps.env("FLOW_MCP_PEPPER") ?? "";
  if (!raw) return null;
  let secret = raw;
  if (raw.trim().startsWith("{")) {
    secret = readJsonKey(raw, "secret");
  }
  if (!secret) return null;
  return new TextEncoder().encode(secret);
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

async function getUserId(deps: Deps, jwt: string): Promise<string | null> {
  const url = deps.env("SUPABASE_URL") ?? "";
  const key = publishableKey(deps);
  if (!url || !key || !jwt) return null;
  const response = await deps.fetch(`${url}/auth/v1/user`, {
    method: "GET",
    headers: { apikey: key, authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { id?: unknown };
  return typeof body.id === "string" ? body.id : null;
}

function bearer(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? "";
}

function appOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin == null) return null;
  return APP_ORIGINS.has(origin) ? origin : null;
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

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
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
  if (body == null) return jsonResponse(req, { error: "validation" }, 400);
  const scope = scopeList(body.scope);
  if (!scope) return jsonResponse(req, { error: "validation" }, 400);
  const pepper = pepperBytes(deps);
  if (!pepper) return jsonResponse(req, { error: "server is missing a secret" }, 500);
  const secret = mintSecret();
  const tokenHash = await hmacSecret(secret, pepper);
  const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const stored = await rpc(deps, "store_mcp_credential", {
    p_user: userId,
    p_token_hash: tokenHash,
    p_scope: scope,
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
  const pepper = pepperBytes(deps);
  if (!pepper) return jsonResponse(req, { error: "server is missing a secret" }, 500);
  const tokenHash = await hmacSecret(token, pepper);
  const found = await rpc(deps, "lookup_mcp_credential", { p_token_hash: tokenHash });
  const row = found.json as {
    found?: unknown;
    id?: unknown;
    user_id?: unknown;
    expires_at?: unknown;
    revoked_at?: unknown;
  } | null;
  const expired = typeof row?.expires_at === "string" && Date.parse(row.expires_at) <= Date.now();
  if (found.status >= 400 || row?.found !== true || row.revoked_at != null || expired || typeof row.id !== "string") {
    return unauthorized(req, await noteFailure(deps, req));
  }
  const limited = await rpc(deps, "bump_mcp_rate", {
    p_token: row.id,
    p_user: row.user_id,
    p_kind: "read",
  });
  const limit = limited.json as { allowed?: unknown; retry_after_seconds?: unknown } | null;
  if (limit?.allowed === false) {
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
  const body = await readBody(req);
  if (body == null) return jsonResponse(req, { error: "one message per request" }, 400);
  const method = typeof body.method === "string" ? body.method : "";
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
  if (method === "tools/list") return jsonResponse(req, { jsonrpc: "2.0", id, result: { tools: [] } }, 200);
  return jsonResponse(req, { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }, 200);
}

export async function handle(req: Request, deps: Deps = defaultDeps): Promise<Response> {
  const url = new URL(req.url);
  const route = routeOf(url);
  if (req.method === "GET") return jsonResponse(req, { error: "method" }, 405);
  if (req.method === "OPTIONS") {
    if (route === "mcp") return jsonResponse(req, { error: "method" }, 405);
    const origin = appOrigin(req);
    if (!origin) return jsonResponse(req, { error: "origin" }, 403);
    return emptyResponse(req, 204, cors(origin));
  }
  if (req.method !== "POST") return jsonResponse(req, { error: "method" }, 405);

  if (route === "mcp") {
    if (req.headers.get("origin") != null) return jsonResponse(req, { error: "origin" }, 403);
    return handleMcp(req, deps);
  }

  const origin = appOrigin(req);
  if (!origin) return jsonResponse(req, { error: "origin" }, 403);
  const userId = await getUserId(deps, bearer(req));
  if (!userId) return jsonResponse(req, { error: "unauthorized" }, 401, cors(origin));
  if (route === "mint") {
    const response = await handleMint(req, deps, userId);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors(origin))) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }
  if (route === "revoke") {
    const response = await handleRevoke(req, deps, userId);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors(origin))) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  }
  const response = await handleStatus(deps, req, userId);
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors(origin))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

/** Criterion 4. A missing cf-connecting-ip is a failed spike, not a pass. */
export function criterion4(header: string | null): { ok: boolean; message: string } {
  if (header == null || header.trim() === "" || header === "absent") {
    return { ok: false, message: "criterion 4 failed: cf-connecting-ip did not reach the function" };
  }
  return { ok: true, message: "criterion 4 passed: cf-connecting-ip reached the function" };
}
