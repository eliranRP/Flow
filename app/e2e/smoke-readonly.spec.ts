import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page, type Request } from "@playwright/test";

// The product has no /reports route. The signed-in surfaces are home, projects, review, and settings.
const readRpcs = new Set([
  "get_dashboard",
  "get_home",
  "list_auto_assigned_today",
  "list_categories",
  "list_project_category",
  "list_review",
  "list_unpaid",
  "project_waiting",
  "sumit_status",
]);

const email = process.env.SMOKE_EMAIL ?? "";
const password = process.env.SMOKE_PASSWORD ?? "";

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

function isRead(request: Request): boolean {
  const method = request.method();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  const url = request.url();
  if (url.includes("/auth/v1/")) return true;
  const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)/.exec(url)?.[1];
  return method === "POST" && rpc != null && readRpcs.has(rpc);
}

function isSumit(url: string): boolean {
  return url.includes("sumit.co.il") || url.includes("/functions/v1/sumit");
}

function watch(page: Page): { consoleErrors: string[]; writes: string[] } {
  const consoleErrors: string[] = [];
  const writes: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });
  page.on("request", (request) => {
    const url = request.url();
    if (isSumit(url)) writes.push(`SUMIT ${request.method()} ${url}`);
    else if (!isRead(request)) writes.push(`${request.method()} ${url}`);
  });
  return { consoleErrors, writes };
}

test("home, projects, review, and settings load with no writes", async ({ page }) => {
  const client = createClient(hosted.url, hosted.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) {
    throw new Error("smoke sign-in failed");
  }
  const session = signed.data.session;

  const watched = watch(page);
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, value);
    },
    { key: storageKey(hosted.url), value: JSON.stringify(session) },
  );
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/");
  await expect(page.getByText("נכנס")).toBeVisible();
  await expect(page.getByText("יצא")).toBeVisible();
  await expect(page.getByRole("heading", { name: "כאן יופיע הרווח הנקי של העסק" })).toHaveCount(0);
  await expect(page.getByText("לא הצלחנו לטעון את הנתונים")).toHaveCount(0);

  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "לאישור" })).toBeVisible();
  await expect(page.getByText("לא הצלחנו לטעון את הנתונים")).toHaveCount(0);

  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "פרויקטים" })).toBeVisible();
  await expect(page.getByText("לא הצלחנו לטעון את הנתונים")).toHaveCount(0);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "הגדרות" })).toBeVisible();
  await expect(page.getByText("Flow Test 2")).toBeVisible();
  await expect(page.getByText("לא הצלחנו לטעון את הנתונים")).toHaveCount(0);

  expect(watched.writes).toEqual([]);
  expect(watched.consoleErrors).toEqual([]);
});
