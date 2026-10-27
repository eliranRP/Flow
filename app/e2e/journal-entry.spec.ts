import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// FLOW-149 (decision 0228). A property's depreciation booked with create_journal_entry: a debit to a
// depreciation category and a credit to Accumulated depreciation. The company profit page counts it
// in its month; the month's cash lines do not list it, while the month's real payment is there; undo
// takes it out of profit. The MCP write goes through PostgREST with the claims the flow-mcp function
// signs (its mcp_tid), as the function does. Invented names and round amounts only.
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

/** Email password login is off. A signed user JWT is the local session; `extra` adds claims (mcp_tid). */
function signedSession(secret: string, anon: string, user: User, extra: Record<string, unknown> = {}): Session {
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
    aal: "aal1",
    email: user.email,
    app_metadata: user.app_metadata,
    user_metadata: user.user_metadata,
    ...extra,
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

/** One MCP write: the envelope's data, or the test fails with the refusal. */
async function mcpWrite(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.rpc(fn, args);
  expect(result.error, result.error?.message).toBeNull();
  const envelope = result.data as { ok: boolean; data?: Record<string, unknown>; error?: { message: string } };
  expect(envelope.ok, `${fn}: ${envelope.error?.message ?? ""}`).toBe(true);
  return envelope.data ?? {};
}

/** The company profit page by category for a month: the row of a category, by its name. */
async function profitCategoryRow(page: Page, month: string, name: string) {
  await page.goto(`/profit?by=category&month=${month}`);
  await expect(page.getByRole("heading", { name: "רווח", exact: true })).toBeVisible();
  await expect(page.locator(".ui-pcat-button").first()).toBeVisible();
  return page.locator(".ui-pcat-button", { hasText: name });
}

test("a depreciation entry counts in the month's profit, stays out of its cash, and undoes", async ({ page }) => {
  const status = localStatus();
  test.skip(!status, "local Supabase is required to book a journal entry");
  if (!status) return;

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email: `journal-${stamp}@test.flow`, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const user = created.data.user;
  expect(user).not.toBeNull();
  if (!user) return;
  const signed = signedSession(status.jwt, status.anon, user);
  const owner = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const applied = await owner.auth.setSession({ access_token: signed.access_token, refresh_token: signed.refresh_token });
  expect(applied.error, applied.error?.message).toBeNull();
  const company = await owner.rpc("create_company", { p_name: `נכסים ${stamp}`, p_vat_registered: true });
  expect(company.error, company.error?.message).toBeNull();
  const companyId = company.data as string;
  const project = await owner.rpc("upsert_project", { p_name: "בית לדוגמה", p_status: "active" });
  expect(project.error, project.error?.message).toBeNull();
  const projectId = project.data as string;

  // A depreciation category in the P&L, and a repair category for the month's one real payment.
  const categories = await admin.from("categories").insert([
    { company_id: companyId, name: "פחת לדוגמה", kind: "expense", sort_order: 900 },
    { company_id: companyId, name: "תיקונים לדוגמה", kind: "expense", sort_order: 901 },
  ]).select("id, name");
  expect(categories.error, categories.error?.message).toBeNull();
  const categoryId = (name: string) => (categories.data as Array<{ id: string; name: string }>).find((row) => row.name === name)?.id;
  const repairs = categoryId("תיקונים לדוגמה");
  const depreciationCategory = categoryId("פחת לדוגמה");
  if (repairs == null || depreciationCategory == null) throw new Error("the categories were not stored");
  const payment = await admin.from("transactions").insert({
    company_id: companyId, direction: "expense", doc_kind: "other", line_status: "posted",
    amount_gross: -40_000, amount_net: -40_000, amount_original: 40_000, vat_amount: 0, vat_status: "unknown",
    doc_date: "2026-09-10", cash_date: "2026-09-10", currency: "ILS", source: "manual",
    idempotency_key: `f149:${stamp}:payment`, description: "תיקון ברז לדוגמה", category_id: repairs,
    project_id: projectId, pnl_role: "project", user_assigned: true,
  });
  expect(payment.error, payment.error?.message).toBeNull();

  const accounts = await admin.from("accounts").select("id, name, category_id").eq("company_id", companyId);
  expect(accounts.error, accounts.error?.message).toBeNull();
  const rows = accounts.data as Array<{ id: string; name: string; category_id: string | null }>;
  const depreciation = rows.find((row) => row.category_id === depreciationCategory)?.id;
  const accumulated = rows.find((row) => row.category_id == null && row.name === "Accumulated depreciation")?.id;
  if (depreciation == null || accumulated == null) throw new Error("the accounts were not provisioned");

  // An MCP key, and the claims the flow-mcp function signs for it.
  const credential = await admin.rpc("store_mcp_credential", {
    p_user: user.id,
    p_token_hash: `hash-flow149-${stamp}`,
    p_scope: ["read", "write"],
    p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_pepper_kid: "e2e",
  });
  expect(credential.error, credential.error?.message).toBeNull();
  const mcpSession = signedSession(status.jwt, status.anon, user, { mcp_tid: credential.data as string });
  const mcp = createClient(status.url, status.anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${mcpSession.access_token}` } },
  });

  const host = new URL(status.url).hostname.split(".")[0] ?? "local";
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: `sb-${host}-auth-token`, value: signed });

  // Before the entry, September's profit has the repair and no depreciation.
  await expect(await profitCategoryRow(page, "2026-09", "פחת לדוגמה")).toHaveCount(0);

  // 5,000.00 of depreciation on the house, at the end of September.
  const entry = await mcpWrite(mcp, "mcp_create_journal_entry", {
    p_idempotency_key: `f149-je-${stamp}`, p_doc_date: "2026-09-30", p_currency: "ILS",
    p_description: "פחת שנתי לדוגמה", p_reference: "JE 1",
    p_legs: [
      { account_id: depreciation, amount_minor: 500_000, project_id: projectId },
      { account_id: accumulated, amount_minor: -500_000, project_id: projectId },
    ],
  });
  expect(entry.undo_kind).toBe("journal_entry");

  const row = await profitCategoryRow(page, "2026-09", "פחת לדוגמה");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("5,000");

  // September's money out lists the repair and not the entry: it moved no money.
  await page.goto("/cash/2026-09/out/ILS");
  await expect(page.getByText("תיקון ברז לדוגמה")).toBeVisible();
  await expect(page.getByText("פחת שנתי לדוגמה")).toHaveCount(0);

  // Undo takes it out of profit.
  await mcpWrite(mcp, "mcp_undo", { p_idempotency_key: `f149-undo-${stamp}`, p_kind: "journal_entry", p_id: entry.id });
  await expect(await profitCategoryRow(page, "2026-09", "פחת לדוגמה")).toHaveCount(0);
});
