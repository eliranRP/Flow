import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// FLOW-148 (decision 0227). A rehab loan files its interest under a kept-out holding-costs category.
// set_loan_part_category moves one attached payment's interest into the P&L and the payment stays on
// the loan; set_loan_category_from switches the interest from a date on and re-files the payments
// after it; undo puts both back. The MCP writes go through PostgREST with the claims the flow-mcp
// function signs (its mcp_tid), as the function does; the screens are the live company profit and
// the loan's payments. Invented names and round amounts only.
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

test("an attached payment's interest moves into the P&L and stays on the loan; a dated switch files the later ones", async ({ page }) => {
  const status = localStatus();
  test.skip(!status, "local Supabase is required to attach a loan payment");
  if (!status) return;

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email: `loan-parts-${stamp}@test.flow`, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const user = created.data.user;
  expect(user).not.toBeNull();
  if (!user) return;
  const signed = signedSession(status.jwt, status.anon, user);
  const owner = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const applied = await owner.auth.setSession({ access_token: signed.access_token, refresh_token: signed.refresh_token });
  expect(applied.error, applied.error?.message).toBeNull();
  const company = await owner.rpc("create_company", { p_name: `שיפוצים ${stamp}`, p_vat_registered: true });
  expect(company.error, company.error?.message).toBeNull();
  const companyId = company.data as string;

  // Holding costs, kept out of the P&L while the rehab runs; after it, the built-in ריבית משכנתא.
  const holding = await admin.from("categories")
    .insert({ company_id: companyId, name: "עלויות החזקה לדוגמה", kind: "expense", sort_order: 900, excluded_from_pnl: true })
    .select("id").single();
  expect(holding.error, holding.error?.message).toBeNull();
  const holdingId = (holding.data as { id: string }).id;
  const keyed = await admin.from("categories").select("id")
    .eq("company_id", companyId).eq("loan_part", "interest").single();
  expect(keyed.error, keyed.error?.message).toBeNull();
  const mortgageInterestId = (keyed.data as { id: string }).id;

  // An MCP key, and the claims the flow-mcp function signs for it.
  const credential = await admin.rpc("store_mcp_credential", {
    p_user: user.id,
    p_token_hash: `hash-flow148-${stamp}`,
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

  // 100,000.00 at 6% over 360 months from January: 1,000.00 a month. Its interest is a holding cost.
  const loan = await mcpWrite(mcp, "mcp_add_loan", {
    p_idempotency_key: `f148-add-${stamp}`, p_name: "הלוואת שיפוץ לדוגמה", p_principal_minor: 10_000_000,
    p_annual_rate_ppm: 60_000, p_term_months: 360, p_start_date: "2026-01-01", p_payment_minor: 100_000,
    p_escrow_minor: 0, p_currency: "ILS",
  });
  const loanId = loan.id as string;
  await mcpWrite(mcp, "mcp_update_loan", {
    p_idempotency_key: `f148-holding-${stamp}`, p_loan_id: loanId, p_patch: { interest_category_id: holdingId },
  });

  // Two payments of 1,000.00, in January (the rehab) and in March (after it).
  const lines: Record<string, string> = {};
  for (const date of ["2026-01-05", "2026-03-05"]) {
    const line = await admin.from("transactions").insert({
      company_id: companyId, direction: "expense", doc_kind: "expense", line_status: "posted",
      amount_gross: -100_000, amount_net: -100_000, amount_original: 100_000, vat_amount: 0, vat_status: "unknown",
      doc_date: date, currency: "ILS", source: "manual", idempotency_key: `f148:${stamp}:${date}`,
      description: "תשלום הלוואה לדוגמה",
    }).select("id").single();
    expect(line.error, line.error?.message).toBeNull();
    lines[date] = (line.data as { id: string }).id;
    await mcpWrite(mcp, "mcp_attach_loan_payment", {
      p_idempotency_key: `f148-attach-${stamp}-${date}`, p_transaction_id: lines[date], p_loan_id: loanId,
      p_parts: [
        { part: "interest", amount_minor: 50_000, scheduled_minor: 50_000 },
        { part: "escrow", amount_minor: 0, scheduled_minor: 0 },
        { part: "principal", amount_minor: 50_000, scheduled_minor: 50_000 },
      ],
    });
  }

  const january = lines["2026-01-05"];
  const march = lines["2026-03-05"];
  if (january == null || march == null) throw new Error("a payment line was not stored");

  const host = new URL(status.url).hostname.split(".")[0] ?? "local";
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: `sb-${host}-auth-token`, value: signed });

  // While the interest is a holding cost, January's profit has no mortgage-interest row.
  await expect(await profitCategoryRow(page, "2026-01", "ריבית משכנתא")).toHaveCount(0);

  // set_loan_part_category: January's interest into the P&L.
  const moved = await mcpWrite(mcp, "mcp_set_loan_part_category", {
    p_idempotency_key: `f148-part-${stamp}`, p_transaction_ids: [january], p_part: "interest",
    p_category_id: mortgageInterestId,
  });
  expect(moved.undo_kind).toBe("loan_part_category");
  const januaryRow = await profitCategoryRow(page, "2026-01", "ריבית משכנתא");
  await expect(januaryRow).toHaveCount(1);
  await expect(januaryRow).toContainText("500");
  // March is still a holding cost.
  await expect(await profitCategoryRow(page, "2026-03", "ריבית משכנתא")).toHaveCount(0);

  // Both payments are still on the loan.
  await page.goto(`/loans/${loanId}/payments`);
  await expect(page.getByText("כל התשלומים", { exact: true })).toBeVisible();
  await expect(page.locator(`a[href^='/transactions/${january}']`)).toHaveCount(1);
  await expect(page.locator(`a[href^='/transactions/${march}']`)).toHaveCount(1);
  const split = await owner.rpc("get_loan_split", { p_transaction_id: january });
  expect(split.error, split.error?.message).toBeNull();
  expect((split.data as { loan_id: string }).loan_id).toBe(loanId);

  // set_loan_category_from: from 1 March, interest is mortgage interest, and March's payment moves.
  const switched = await mcpWrite(mcp, "mcp_set_loan_category_from", {
    p_idempotency_key: `f148-switch-${stamp}`, p_loan_id: loanId, p_part: "interest", p_effective_date: "2026-03-01",
    p_category_id: mortgageInterestId, p_apply_to_existing: true,
  });
  expect((switched.moved as unknown[]).length).toBe(1);
  await expect(await profitCategoryRow(page, "2026-03", "ריבית משכנתא")).toHaveCount(1);

  // Undo of the switch puts March back in holding costs; undo of the part move puts January back.
  await mcpWrite(mcp, "mcp_undo", { p_idempotency_key: `f148-undo-switch-${stamp}`, p_kind: "loan_category_from", p_id: switched.id });
  await expect(await profitCategoryRow(page, "2026-03", "ריבית משכנתא")).toHaveCount(0);
  await mcpWrite(mcp, "mcp_undo", { p_idempotency_key: `f148-undo-part-${stamp}`, p_kind: "loan_part_category", p_id: moved.id });
  await expect(await profitCategoryRow(page, "2026-01", "ריבית משכנתא")).toHaveCount(0);
});
