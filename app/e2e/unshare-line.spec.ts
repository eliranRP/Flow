import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// FLOW-150 (decision 0229). A property manager's fee shared 50/50 between two houses moves 100% to
// one house with assign_expense and unshare: the company profit page by project shows the whole fee on
// that house; undo splits it again. The MCP writes go through PostgREST with the claims the flow-mcp
// function signs (its mcp_tid), as the function does. Invented names and round amounts only.
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

/** The company profit page by project for a month: the row of a project, by its name. */
async function projectRow(page: Page, month: string, name: string) {
  await page.goto(`/profit?month=${month}`);
  await expect(page.getByRole("heading", { name: "רווח", exact: true })).toBeVisible();
  await expect(page.locator(".ui-cp-row").first()).toBeVisible();
  return page.locator(".ui-cp-row", { hasText: name });
}

test("a shared fee moves wholly to one house and back with undo", async ({ page }) => {
  const status = localStatus();
  test.skip(!status, "local Supabase is required to move a shared line");
  if (!status) return;

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email: `unshare-${stamp}@test.flow`, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const user = created.data.user;
  expect(user).not.toBeNull();
  if (!user) return;
  const signed = signedSession(status.jwt, status.anon, user);
  const owner = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const applied = await owner.auth.setSession({ access_token: signed.access_token, refresh_token: signed.refresh_token });
  expect(applied.error, applied.error?.message).toBeNull();
  const company = await owner.rpc("create_company", { p_name: `בתים ${stamp}`, p_vat_registered: true });
  expect(company.error, company.error?.message).toBeNull();
  const companyId = company.data as string;
  const projects: string[] = [];
  for (const name of ["בית אלון לדוגמה", "בית ארז לדוגמה"]) {
    const project = await owner.rpc("upsert_project", { p_name: name, p_status: "active" });
    expect(project.error, project.error?.message).toBeNull();
    projects.push(project.data as string);
  }
  const [oak, cedar] = projects;
  if (oak == null || cedar == null) throw new Error("the projects were not stored");
  const category = await admin.from("categories")
    .insert({ company_id: companyId, name: "ניהול נכס לדוגמה", kind: "expense", sort_order: 900 })
    .select("id").single();
  expect(category.error, category.error?.message).toBeNull();
  const categoryId = (category.data as { id: string }).id;
  const line = await admin.from("transactions").insert({
    company_id: companyId, direction: "expense", doc_kind: "other", line_status: "posted",
    amount_gross: -123_400, amount_net: -123_400, amount_original: 123_400, vat_amount: 0, vat_status: "unknown",
    doc_date: "2026-09-11", cash_date: "2026-09-11", currency: "ILS", source: "manual",
    idempotency_key: `f150:${stamp}`, description: "דמי ניהול לדוגמה",
  }).select("id").single();
  expect(line.error, line.error?.message).toBeNull();
  const lineId = (line.data as { id: string }).id;

  // An MCP key, and the claims the flow-mcp function signs for it.
  const credential = await admin.rpc("store_mcp_credential", {
    p_user: user.id,
    p_token_hash: `hash-flow150-${stamp}`,
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

  // 1,234.00 shared 50/50: 617 on each house.
  await mcpWrite(mcp, "mcp_assign_expense_split", {
    p_idempotency_key: `f150-split-${stamp}`, p_transaction_id: lineId,
    p_shares: [{ project_id: oak, share: 50 }, { project_id: cedar, share: 50 }], p_category_id: categoryId,
  });

  const host = new URL(status.url).hostname.split(".")[0] ?? "local";
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: `sb-${host}-auth-token`, value: signed });

  await expect(await projectRow(page, "2026-09", "בית אלון לדוגמה")).toContainText("617");
  await expect(await projectRow(page, "2026-09", "בית ארז לדוגמה")).toContainText("617");

  // unshare: the whole fee on the oak house, under its own category.
  const moved = await mcpWrite(mcp, "mcp_assign_expense", {
    p_idempotency_key: `f150-unshare-${stamp}`, p_transaction_id: lineId, p_project_id: oak,
    p_category_id: null, p_remember: false, p_unshare: true,
  });
  expect(moved.unshared).toBe(true);
  await expect(await projectRow(page, "2026-09", "בית אלון לדוגמה")).toContainText("1,234");
  // The cedar house has nothing left in September, so the page draws no row for it.
  await expect(await projectRow(page, "2026-09", "בית ארז לדוגמה")).toHaveCount(0);

  // Undo splits it again.
  await mcpWrite(mcp, "mcp_undo", { p_idempotency_key: `f150-undo-${stamp}`, p_kind: "reassign", p_id: moved.id });
  await expect(await projectRow(page, "2026-09", "בית אלון לדוגמה")).toContainText("617");
  await expect(await projectRow(page, "2026-09", "בית ארז לדוגמה")).toContainText("617");
});
