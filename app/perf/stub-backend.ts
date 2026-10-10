import type { Page, Route } from "@playwright/test";
import { demoDashboard, demoProject, demoReview, demoUnpaid } from "../src/demo/model";

/**
 * FLOW-804: the perf build talks to this address (playwright.perf.config.ts). Nothing listens
 * there; every request to it is answered here from the demo books (invented names), so a timing
 * covers the app's code and render and none of it reaches a real server.
 */
export const STUB_URL = "http://127.0.0.1:43199";
export const STUB_ANON_KEY = "perf-stub-anon-key";

/** The wire form of a read: bigints go out as strings, as PostgREST sends numerics. */
function wire(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item));
}

function rpcName(url: string): string | null {
  return /\/rest\/v1\/rpc\/([^/?]+)/.exec(url)?.[1] ?? null;
}

function rpcBody(name: string, args: Record<string, unknown>): unknown {
  const from = typeof args.p_from === "string" ? args.p_from : null;
  const to = typeof args.p_to === "string" ? args.p_to : null;
  switch (name) {
    case "get_dashboard":
      return demoDashboard(from, to, "invoiced");
    case "get_project":
      return demoProject(typeof args.p_id === "string" ? args.p_id : "");
    case "list_unpaid":
      return demoUnpaid();
    case "list_review":
      return demoReview();
    case "sumit_status":
      return { connected: true, sumit_company_id: 1, last_sync_at: "2026-10-09T06:00:00Z", last_error: null };
    case "mcp_company_loan_currency":
      return "ILS";
    case "list_my_companies":
      return {
        active_id: COMPANY_ID,
        role: "owner",
        companies: [{ id: COMPANY_ID, name: "Example Renovations", role: "owner", is_demo: false, active: true }],
      };
    default:
      return [];
  }
}

/** The one company the stub user owns; the app names it on every read once list_my_companies answers. */
const COMPANY_ID = "00000000-0000-4000-8000-000000000805";

const USER = {
  id: "00000000-0000-4000-8000-000000000804",
  aud: "authenticated",
  role: "authenticated",
  email: "perf@example.com",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** A signed-in session the client reads from storage; the stub never checks the signature. */
function session(): string {
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  const token = [
    base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64url(JSON.stringify({ sub: USER.id, aud: "authenticated", role: "authenticated", exp })),
    "perf",
  ].join(".");
  return JSON.stringify({
    access_token: token,
    refresh_token: "perf-refresh",
    token_type: "bearer",
    expires_in: 24 * 3600,
    expires_at: exp,
    user: USER,
  });
}

export interface StubBackend {
  /** RPC names read so far, in order. */
  rpcs: string[];
  /** Requests to the stub not answered yet. */
  inflight: () => number;
}

export interface StubOptions {
  /** How long the server takes to answer an RPC, in ms: the REST floor or a spike (default 0). */
  delay?: (rpc: string) => number;
}

/** Signs the page in and answers every request to the stub address from the demo books. */
export async function stubBackend(page: Page, options: StubOptions = {}): Promise<StubBackend> {
  const rpcs: string[] = [];
  let open = 0;
  const key = `sb-${new URL(STUB_URL).hostname.split(".")[0] ?? "local"}-auth-token`;
  await page.addInitScript(({ storageKey, value }) => {
    localStorage.setItem(storageKey, value);
  }, { storageKey: key, value: session() });
  await page.route(`${STUB_URL}/**`, async (route: Route) => {
    open += 1;
    try {
      const request = route.request();
      const url = request.url();
      const name = rpcName(url);
      if (name) {
        rpcs.push(name);
        const args = (request.postDataJSON() ?? {}) as Record<string, unknown>;
        const wait = options.delay?.(name) ?? 0;
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        await route.fulfill({ status: 200, contentType: "application/json", body: wire(rpcBody(name, args)) });
      } else if (url.includes("/auth/v1/user")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USER) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
    } finally {
      open -= 1;
    }
  });
  return { rpcs, inflight: () => open };
}
