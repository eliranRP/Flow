import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type Session, type User } from "@supabase/supabase-js";
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

test("a cold open on /review waits when Jev was remembered on", async ({ page }) => {
  const status = localStatus();
  test.skip(!status, "local Supabase is required for a cold /review");
  if (!status) return;

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const supplier = `ספק קר ${stamp}`;
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email: `cold-${stamp}@test.flow`, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const user = created.data.user;
  expect(user).not.toBeNull();
  if (!user) return;
  const signed = ownerSession(status.jwt, status.anon, user);
  const anon = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const applied = await anon.auth.setSession({ access_token: signed.access_token, refresh_token: signed.refresh_token });
  expect(applied.error, applied.error?.message).toBeNull();

  const company = await anon.rpc("create_company", { p_name: `קר ${stamp}`, p_vat_registered: true });
  expect(company.error, company.error?.message).toBeNull();
  const project = await anon.rpc("upsert_project", { p_name: "הרצל", p_status: "active" });
  expect(project.error, project.error?.message).toBeNull();
  const categories = await anon.rpc("list_categories");
  expect(categories.error, categories.error?.message).toBeNull();
  const rows = Array.isArray(categories.data)
    ? categories.data as Array<{ id: string; name: string; kind: string }>
    : [];
  const materials = rows.find((row) => row.name === "חומרים" && row.kind === "expense");
  expect(materials?.id).toBeTruthy();
  const companyId = company.data as string;
  const projectId = project.data as string;
  const txn = await admin.from("transactions").insert({
    company_id: companyId,
    direction: "expense",
    doc_kind: "expense",
    pnl_role: "project",
    amount_gross: -10000,
    amount_net: -10000,
    amount_original: 10000,
    vat_amount: 0,
    vat_status: "unknown",
    doc_date: "2026-09-28",
    source: "manual",
    idempotency_key: `cold-review:${stamp}`,
    project_id: projectId,
    category_id: materials?.id,
    description: supplier,
    user_assigned: true,
    category_suggested: false,
  }).select("id").single();
  expect(txn.error, txn.error?.message).toBeNull();
  const review = await admin.from("review_queue").insert({
    company_id: companyId,
    transaction_id: txn.data?.id,
    status: "open",
    reason: "missing_category",
  }).select("id").single();
  expect(review.error, review.error?.message).toBeNull();

  const host = new URL(status.url).hostname.split(".")[0] ?? "local";
  let releaseRead: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const dashboards: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/rpc/get_dashboard")) dashboards.push(request.url());
  });
  await page.route("**/rest/v1/company_integrations*", async (route) => {
    await gate;
    await route.continue();
  });
  await page.addInitScript(({ key, value, flagKey }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.localStorage.setItem(flagKey, "1");
    window.localStorage.setItem("flow.jev-connector", "1");
  }, {
    key: `sb-${host}-auth-token`,
    value: signed,
    flagKey: `flow.jev-connector:${user.id}:${companyId}`,
  });

  try {
    await page.goto("/review");
    await expect(page.locator("[data-jev-pending]")).toBeVisible();
    await expect(page.getByRole("button", { name: "אישור" })).toBeDisabled();
    await expect(page.locator(".ui-suggest-tag")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: supplier })).toBeVisible();
    expect(dashboards).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("flow.jev-connector"))).toBeNull();
  } finally {
    releaseRead();
  }
  await expect(page.locator("[data-jev-pending]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "אישור" })).toBeEnabled();
  await expect(page.locator(".ui-suggest-tag")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "פרויקט: הרצל" })).toBeVisible();
  expect(dashboards).toEqual([]);
});
