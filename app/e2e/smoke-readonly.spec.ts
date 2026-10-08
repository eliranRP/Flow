import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page, type Request, type Response } from "@playwright/test";

// List screens only. Detail RPCs stay on the owner and are not called.
const readRpcs = new Set(["get_dashboard", "get_line_meta", "list_categories", "list_review", "list_unpaid", "sumit_status"]);

const email = process.env.SMOKE_EMAIL ?? "";
const password = process.env.SMOKE_PASSWORD ?? "";
const companyName = process.env.SMOKE_COMPANY_NAME?.trim() || "Flow Test";

function hostedEnv(): { url: string; anonKey: string } {
  const fromEnv = {
    url: process.env.VITE_SUPABASE_URL?.trim() ?? "",
    anonKey: process.env.VITE_SUPABASE_ANON_KEY?.trim() ?? "",
  };
  if (fromEnv.url.length > 0 && fromEnv.anonKey.length > 0) return fromEnv;
  const text = readFileSync(new URL("../.env.production", import.meta.url), "utf8");
  const found: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)=(.*)$/.exec(line.trim());
    const key = match?.[1];
    const value = match?.[2];
    if (key == null || value == null) continue;
    found[key] = value.replace(/^['"]|['"]$/g, "");
  }
  return {
    url: found.VITE_SUPABASE_URL ?? "",
    anonKey: found.VITE_SUPABASE_ANON_KEY ?? "",
  };
}

const hosted = email.length > 0 && password.length > 0 ? hostedEnv() : { url: "", anonKey: "" };
const ready = email.length > 0 && password.length > 0 && hosted.url.length > 0 && hosted.anonKey.length > 0;

test.skip(!ready, "SMOKE_EMAIL or SMOKE_PASSWORD is unset.");

function storageKey(url: string): string {
  const ref = new URL(url).hostname.split(".")[0] ?? "local";
  return `sb-${ref}-auth-token`;
}

function rpcName(url: string): string | null {
  return /\/rest\/v1\/rpc\/([a-z0-9_]+)/.exec(url)?.[1] ?? null;
}

function requestPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Token refresh and the user read only. Other `/auth/v1/` paths, including signup and admin, are writes. */
function isAuthAllowed(request: Request): boolean {
  const path = requestPath(request.url());
  const user = path.endsWith("/auth/v1/user");
  const token = path.endsWith("/auth/v1/token");
  if (!user && !token) return false;
  const method = request.method();
  if (method === "OPTIONS" || method === "HEAD") return true;
  if (user) return method === "GET";
  return method === "POST";
}

function isRead(request: Request): boolean {
  const url = request.url();
  if (requestPath(url).includes("/auth/v1/")) return isAuthAllowed(request);
  const method = request.method();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  if (method === "POST" && /\/functions\/v1\/flow-mcp\/status(?:\?|$)/.test(url)) return true;
  const rpc = rpcName(url);
  return method === "POST" && rpc != null && readRpcs.has(rpc);
}

function isSumit(url: string): boolean {
  return url.includes("sumit.co.il") || url.includes("/functions/v1/sumit");
}

const edgeAllowHeaders = ["authorization", "apikey", "content-type", "x-client-info"];

function isEdge(url: string): boolean {
  return url.includes("/functions/v1/");
}

function missingEdgeHeaders(response: Response): string[] {
  const allow = response.headers()["access-control-allow-headers"] ?? "";
  const names = new Set(allow.split(",").map((part) => part.trim().toLowerCase()));
  return edgeAllowHeaders.filter((name) => !names.has(name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function jsonAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return 0;
}

async function watch(page: Page): Promise<{
  consoleErrors: string[];
  writes: string[];
  httpErrors: string[];
  edgeResponses: Response[];
  inflight: () => number;
}> {
  const consoleErrors: string[] = [];
  const writes: string[] = [];
  const httpErrors: string[] = [];
  const edgeResponses: Response[] = [];
  let open = 0;
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) httpErrors.push(`${String(response.status())} ${response.url()}`);
    if (isEdge(response.url())) edgeResponses.push(response);
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = request.url();
    if (isSumit(url) || !isRead(request)) {
      writes.push(isSumit(url) ? `SUMIT ${request.method()} ${url}` : `${request.method()} ${url}`);
      await route.abort("blockedbyclient");
      return;
    }
    open += 1;
    try {
      await route.continue();
      await request.response();
    } finally {
      open -= 1;
    }
  });
  return { consoleErrors, writes, httpErrors, edgeResponses, inflight: () => open };
}

function waitRpc(page: Page, name: string): Promise<Response> {
  return page.waitForResponse((response) => response.request().method() === "POST" && rpcName(response.url()) === name);
}

function waitStatus(page: Page): Promise<Response> {
  return page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/functions\/v1\/flow-mcp\/status(?:\?|$)/.test(response.url()),
  );
}

function responseAt(responses: Response[], index: number): Response {
  const response = responses[index];
  if (response == null) throw new Error("missing response");
  return response;
}

/** The stored session is present before list RPCs are accepted. */
async function waitForStoredSession(page: Page): Promise<void> {
  const key = storageKey(hosted.url);
  await page.waitForFunction((storageKey) => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return false;
      const session = JSON.parse(raw) as { access_token?: unknown };
      return typeof session.access_token === "string" && session.access_token.length > 0;
    } catch {
      return false;
    }
  }, key);
}

async function openList(page: Page, path: string, rpcs: string[], inflight: () => number): Promise<Response[]> {
  const pending = rpcs.map((name) => waitRpc(page, name));
  await page.goto(path);
  await waitForStoredSession(page);
  const responses = await Promise.all(pending);
  for (const response of responses) {
    expect(response.status(), response.url()).toBe(200);
  }
  await expect.poll(inflight).toBe(0);
  expect(new URL(page.url()).pathname).toBe(path);
  return responses;
}

test("home, projects, review, and settings load from list reads", async ({ page }) => {
  const client = createClient(hosted.url, hosted.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error("smoke sign-in failed");
  const session = signed.data.session;

  const watched = await watch(page);
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: storageKey(hosted.url), value: JSON.stringify(session) },
  );
  await page.setViewportSize({ width: 390, height: 844 });

  const homeResponses = await openList(page, "/", ["get_dashboard", "list_unpaid"], watched.inflight);
  expect(watched.httpErrors, watched.httpErrors.join("\n")).toEqual([]);
  const home = await responseAt(homeResponses, 0).json() as unknown;
  const unpaidRows = await responseAt(homeResponses, 1).json() as unknown;
  expect(isRecord(home)).toBe(true);
  if (!isRecord(home)) throw new Error("dashboard");
  expect(home.name).toBe(companyName);
  expect(isUnknownArray(unpaidRows)).toBe(true);
  const projects = isUnknownArray(home.projects) ? home.projects : [];
  const hasBooks = jsonAmount(home.income_agorot) !== 0 || jsonAmount(home.expense_agorot) !== 0 || projects.length > 0;
  if (hasBooks) {
    await expect(page.getByText("נכנס", { exact: true })).toBeVisible();
    await expect(page.getByText("יצא", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "הוספה" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "הוספה" })).toHaveCount(0);
  if (!hasBooks) await expect(page.getByRole("link", { name: "חיבור SUMIT" })).toHaveCount(0);
  await expect(page.getByText("לא הצלחנו לטעון את הנתונים")).toHaveCount(0);

  const projectResponses = await openList(page, "/projects", ["get_dashboard"], watched.inflight);
  expect(watched.httpErrors, watched.httpErrors.join("\n")).toEqual([]);
  const projectHome = await responseAt(projectResponses, 0).json() as unknown;
  expect(isRecord(projectHome)).toBe(true);
  if (!isRecord(projectHome)) throw new Error("dashboard");
  expect(projectHome.name).toBe(companyName);
  await expect(page.getByRole("heading", { name: "פרויקטים" })).toBeVisible();
  const listed = isUnknownArray(projectHome.projects) ? projectHome.projects : [];
  const first = listed[0];
  const firstName = isRecord(first) && typeof first.name === "string" ? first.name : "";
  if (listed.length === 0) {
    await expect(page.getByText("עוד אין פרויקטים", { exact: true })).toBeVisible();
  } else {
    expect(firstName.length).toBeGreaterThan(0);
    await expect(page.getByText(firstName, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "פרויקט חדש" })).toHaveCount(0);
  await expect(page.getByText("ואפשר גם לפתוח אחד כאן")).toHaveCount(0);
  await expect(page.getByText("לא הצלחנו לטעון את הנתונים")).toHaveCount(0);

  const reviewResponses = await openList(page, "/review", ["list_review"], watched.inflight);
  expect(watched.httpErrors, watched.httpErrors.join("\n")).toEqual([]);
  const reviewRows = await responseAt(reviewResponses, 0).json() as unknown;
  expect(isUnknownArray(reviewRows)).toBe(true);
  await expect(page.getByText("מסמכים שמחכים לשיוך")).toBeVisible();
  if (!isUnknownArray(reviewRows) || reviewRows.length === 0) {
    await expect(page.getByText("הכל מאושר", { exact: true })).toBeVisible();
  } else {
    const card = reviewRows[0];
    const label = isRecord(card)
      ? (typeof card.supplier_name === "string" && card.supplier_name.length > 0
        ? card.supplier_name
        : typeof card.description === "string"
          ? card.description
          : "")
      : "";
    expect(label.length).toBeGreaterThan(0);
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "אישור" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "שינוי" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "דלג" })).toHaveCount(0);
  await expect(page.getByText("לא הצלחנו לטעון את הנתונים")).toHaveCount(0);

  const consoleBeforeSettings = watched.consoleErrors.length;
  const statusCall = waitStatus(page);
  const settingsResponses = await openList(page, "/settings", ["get_dashboard", "sumit_status"], watched.inflight);
  const status = await statusCall;
  expect(status.status(), status.url()).toBe(200);
  expect(missingEdgeHeaders(status), status.headers()["access-control-allow-headers"] ?? "").toEqual([]);
  expect(watched.httpErrors, watched.httpErrors.join("\n")).toEqual([]);
  const settingsHome = await responseAt(settingsResponses, 0).json() as unknown;
  const sumitStatus = await responseAt(settingsResponses, 1).json() as unknown;
  expect(isRecord(settingsHome)).toBe(true);
  if (!isRecord(settingsHome)) throw new Error("dashboard");
  expect(settingsHome.name).toBe(companyName);
  expect(isRecord(sumitStatus)).toBe(true);
  if (!isRecord(sumitStatus)) throw new Error("sumit_status");
  expect(typeof sumitStatus.connected).toBe("boolean");
  await expect(page.getByRole("heading", { name: "הגדרות" })).toBeVisible();
  await expect(page.getByText(companyName, { exact: true })).toBeVisible();
  // FLOW-501: the connector rows live on the Connections page, which a viewer can open.
  await page.getByRole("link", { name: "חיבורים" }).click();
  await expect(page.getByRole("heading", { name: "חיבורים" })).toBeVisible();
  await expect(page.getByText("תיוג חכם (Jev)", { exact: true })).toBeVisible();
  const sumitWord = sumitStatus.connected === true ? "מחובר" : "לא מחובר";
  await expect(page.getByRole("button", { name: "SUMIT", exact: true })).toHaveCount(0);
  const sumitRow = page.locator(".ui-row", { hasText: "SUMIT" }).first();
  await expect(sumitRow.getByText(sumitWord, { exact: true })).toBeVisible();
  await expect(page.getByText("צפייה בלבד · שינויים נעשים על ידי בעל העסק")).toBeVisible();
  await expect(page.getByText("לא הצלחנו לטעון את הנתונים")).toHaveCount(0);
  const settingsErrors = watched.consoleErrors.slice(consoleBeforeSettings);
  expect(settingsErrors, settingsErrors.join("\n")).toEqual([]);
  const corsFailures = watched.edgeResponses.flatMap((response) => {
    const missing = missingEdgeHeaders(response);
    if (missing.length === 0) return [];
    return [`${response.request().method()} ${response.url()} missing ${missing.join(", ")}`];
  });
  expect(watched.edgeResponses.length).toBeGreaterThan(0);
  expect(corsFailures, corsFailures.join("\n")).toEqual([]);

  expect(watched.writes, watched.writes.join("\n")).toEqual([]);
  expect(watched.consoleErrors, watched.consoleErrors.join("\n")).toEqual([]);
  expect(watched.httpErrors, watched.httpErrors.join("\n")).toEqual([]);
});
