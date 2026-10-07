import { createHmac } from "node:crypto";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

function localStatus(): { url: string; anon: string; service: string; jwt: string } | null {
  if (!process.env.FLOW_E2E_SUPABASE_URL) return null;
  try {
    const text = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
    const read = (name: string) => {
      const line = text.split("\n").find((entry) => entry.startsWith(`${name}=`));
      return line ? line.slice(name.length + 1).replace(/^"|"$/g, "") : "";
    };
    const url = read("API_URL") || process.env.FLOW_E2E_SUPABASE_URL;
    const anon = read("ANON_KEY") || process.env.FLOW_E2E_SUPABASE_ANON_KEY || "";
    const service = read("SERVICE_ROLE_KEY");
    const jwt = read("JWT_SECRET");
    if (!url.startsWith("http://127.0.0.1:") && !url.startsWith("http://localhost:")) return null;
    if (!anon || !service || !jwt) return null;
    return { url, anon, service, jwt };
  } catch {
    return null;
  }
}

/** Email password login is off. A signed user JWT is the local session. */
function ownerSession(secret: string, anon: string, user: User): Session {
  const payload = anon.split(".")[1] ?? "";
  const issuer = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { iss?: string };
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    iss: issuer.iss ?? "supabase",
    sub: user.id,
    role: "authenticated",
    email: user.email,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
  })).toString("base64url");
  const data = `${header}.${body}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return {
    access_token: `${data}.${signature}`,
    refresh_token: `${data}.${signature}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user,
  };
}

type Line = { direction: "expense" | "income"; ownName: string; otherName: string; heading: string };

async function pickReversal(page: import("@playwright/test").Page, line: Line) {
  const status = localStatus();
  test.skip(!status, "local Supabase is required for the real review save");
  if (!status) return;

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `reversal-${stamp}@test.flow`;
  const supplier = `ספק החזר ${stamp}`;
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const user = created.data.user;
  expect(user).not.toBeNull();
  if (!user) return;
  const session = ownerSession(status.jwt, status.anon, user);
  const anon = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const applied = await anon.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  expect(applied.error, applied.error?.message).toBeNull();

  const company = await anon.rpc("create_company", { p_name: `החזר ${stamp}`, p_vat_registered: true });
  expect(company.error, company.error?.message).toBeNull();
  const project = await anon.rpc("upsert_project", { p_name: "הרצל", p_status: "active" });
  expect(project.error, project.error?.message).toBeNull();
  const categories = await anon.rpc("list_categories");
  expect(categories.error, categories.error?.message).toBeNull();
  const rows = Array.isArray(categories.data)
    ? categories.data as Array<{ id: string; name: string; kind: string }>
    : [];
  const ownKind = line.direction === "income" ? "income" : "expense";
  const otherKind = line.direction === "income" ? "expense" : "income";
  const own = rows.find((row) => row.name === line.ownName && row.kind === ownKind);
  const other = rows.find((row) => row.name === line.otherName && row.kind === otherKind);
  expect(own?.id).toBeTruthy();
  expect(other?.id).toBeTruthy();

  const income = line.direction === "income";
  const idempotency = `reversal-e2e:${stamp}`;
  const txn = await admin.from("transactions").insert({
    company_id: company.data as string,
    direction: line.direction,
    doc_kind: income ? "receipt" : "expense",
    pnl_role: income ? null : "project",
    amount_gross: income ? 10000 : -10000,
    amount_net: income ? 10000 : -10000,
    amount_original: 10000,
    vat_amount: 0,
    vat_status: "unknown",
    doc_date: "2026-09-28",
    source: "manual",
    idempotency_key: idempotency,
    project_id: project.data as string,
    category_id: own?.id,
    description: supplier,
    user_assigned: false,
  }).select("id").single();
  expect(txn.error, txn.error?.message).toBeNull();
  const review = await admin.from("review_queue").insert({
    company_id: company.data as string,
    transaction_id: txn.data?.id,
    status: "open",
    reason: "missing_category",
  }).select("id").single();
  expect(review.error, review.error?.message).toBeNull();

  const host = new URL(status.url).hostname.split(".")[0] ?? "local";
  const storageKey = `sb-${host}-auth-token`;
  const stored: Session = session;
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: stored });

  await page.goto("/review");
  await expect(page.getByRole("heading", { name: supplier })).toBeVisible();
  await page.getByRole("button", { name: /קטגוריה:/ }).click();
  await expect(page.getByRole("heading", { name: "בחירת קטגוריה" })).toBeVisible();
  await expect(page.getByRole("radio", { name: line.otherName })).toHaveCount(0);
  const toggle = page.getByRole("button", { name: line.heading });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("radiogroup", { name: line.heading }).getByRole("radio", { name: line.otherName }).click();
  await expect(page.getByRole("heading", { name: supplier })).toBeVisible();
  await expect(page.getByRole("button", { name: `קטגוריה: ${line.otherName}, החזר` })).toBeVisible();

  const saved = await admin.from("transactions").select("category_id").eq("idempotency_key", idempotency).single();
  expect(saved.data?.category_id).toBe(other?.id);
}

test("an outflow can be filed under an income category from the review card", async ({ page }) => {
  await pickReversal(page, { direction: "expense", ownName: "חומרים", otherName: "הכנסה אחרת", heading: "הכנסה שהוחזרה" });
});

test("an inflow can be filed under an expense category from the review card", async ({ page }) => {
  await pickReversal(page, { direction: "income", ownName: "תקבול מלקוח", otherName: "הובלה", heading: "הוצאה שהוחזרה" });
});
