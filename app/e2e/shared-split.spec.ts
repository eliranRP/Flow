// A shared expense from לאישור: its אישור opens the split by categories and projects, the split saves
// while the line's unallocated_shared review is open, saving closes that review, and the next sync
// leaves the line closed (20261026110000_shared_line_split.sql). Runs against local Supabase with a
// fresh owner, like the other database specs. Invented names only.
import { createHmac } from "node:crypto";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

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

const PICK_CATEGORY = /^(בחירת קטגוריה|קטגוריה לחלק \d+)$/;
const PICK_PROJECT = /^(בחירת פרויקט|פרויקט לחלק \d+)$/;

/** A fresh owner with one shared expense waiting in לאישור as unallocated_shared, signed in on the page. */
async function seedShared(page: Page, status: NonNullable<ReturnType<typeof localStatus>>, onProject = false) {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const supplier = `ספק משותף ${stamp}`;
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email: `shared-${stamp}@test.flow`, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const user = created.data.user;
  if (!user) throw new Error("no user");
  const session = ownerSession(status.jwt, status.anon, user);
  const anon = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const applied = await anon.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  expect(applied.error, applied.error?.message).toBeNull();

  const company = await anon.rpc("create_company", { p_name: `משותף ${stamp}`, p_vat_registered: true });
  expect(company.error, company.error?.message).toBeNull();
  const companyId = company.data as string;
  const projectIds: string[] = [];
  for (const name of ["הרצל", "צפון"]) {
    const project = await anon.rpc("upsert_project", { p_name: name, p_status: "active" });
    expect(project.error, project.error?.message).toBeNull();
    projectIds.push(project.data as string);
  }
  const categories = await anon.rpc("list_categories");
  const rows = Array.isArray(categories.data) ? categories.data as Array<{ id: string; name: string; kind: string }> : [];
  const materials = rows.find((row) => row.name === "חומרים" && row.kind === "expense");
  expect(materials?.id).toBeTruthy();

  const txn = await admin.from("transactions").insert({
    company_id: companyId,
    direction: "expense",
    doc_kind: "expense",
    pnl_role: "shared",
    amount_gross: -16000,
    amount_net: -16000,
    amount_original: 16000,
    vat_amount: 0,
    vat_status: "unknown",
    doc_date: "2026-09-28",
    source: "sumit",
    idempotency_key: `shared-e2e:${stamp}`,
    category_id: materials?.id,
    // A shared line can carry a project already, as the owner's did: the rest of the split shows it.
    project_id: onProject ? projectIds[0] : null,
    description: supplier,
    user_assigned: false,
  }).select("id").single();
  expect(txn.error, txn.error?.message).toBeNull();
  const transactionId = txn.data?.id as string;
  // The sync queues the shared line the way a bank or SUMIT sync does.
  const synced = await admin.rpc("sync_review_queue", { p_company_id: companyId });
  expect(synced.error, synced.error?.message).toBeNull();
  const queued = await admin.from("review_queue").select("reason").eq("transaction_id", transactionId).eq("status", "open");
  expect(queued.data).toEqual([{ reason: "unallocated_shared" }]);

  const host = new URL(status.url).hostname.split(".")[0] ?? "local";
  const stored: Session = session;
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: `sb-${host}-auth-token`, value: stored });

  return { admin, supplier, companyId, transactionId, projectId: projectIds[0] ?? "" };
}

test("a shared expense's אישור opens the split, the split saves, and the review closes for good", async ({ page }) => {
  const status = localStatus();
  test.skip(!status, "local Supabase is required for the real split save");
  if (!status) return;
  const { admin, supplier, companyId, transactionId } = await seedShared(page, status);

  await page.goto("/review");
  await expect(page.getByRole("heading", { name: supplier })).toBeVisible();
  // אישור waits for the card's reads (Jev, line meta) to settle before it acts.
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "אישור", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/transactions/${transactionId}/split-category`));
  await expect(page.getByRole("heading", { name: "פיצול", exact: true })).toBeVisible();
  // The split used to refuse here with "approve it in the queue first".
  await expect(page.getByText("אשרו את התנועה בתור לאישור, ואז פצלו.")).toHaveCount(0);

  await page.getByRole("button", { name: "חלק נוסף" }).click();
  await page.getByRole("button", { name: /, קטגוריה, שינוי$/ }).last().click();
  await page.getByRole("dialog", { name: PICK_CATEGORY }).getByRole("radio", { name: "חומרים" }).click();
  await page.getByRole("dialog", { name: PICK_PROJECT }).getByRole("radio", { name: "הרצל" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("סכום, חומרים").fill("100");
  await page.getByRole("button", { name: /^שמירת הפיצול/ }).click();
  await expect(page.getByText("הפיצול נשמר")).toBeVisible();
  await expect(page.getByText("אשרו את התנועה בתור לאישור, ואז פצלו.")).toHaveCount(0);

  const parts = await admin.from("line_splits").select("amount_minor").eq("transaction_id", transactionId).order("ordinal");
  expect((parts.data ?? []).map((part: { amount_minor: number }) => part.amount_minor)).toContain(10000);
  const closed = await admin.from("review_queue").select("status, reason").eq("transaction_id", transactionId);
  expect(closed.data).toEqual([{ status: "changed", reason: "unallocated_shared" }]);

  // The next sync leaves the split shared line closed, and לאישור no longer shows it.
  const synced = await admin.rpc("sync_review_queue", { p_company_id: companyId });
  expect(synced.error, synced.error?.message).toBeNull();
  const open = await admin.from("review_queue").select("id").eq("transaction_id", transactionId).eq("status", "open");
  expect(open.data).toEqual([]);
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: supplier })).toHaveCount(0);
});

test("a shared expense on a project, with no part, is approved whole from the split (owner, 2026-10-26)", async ({ page }) => {
  const status = localStatus();
  test.skip(!status, "local Supabase is required for the real approve");
  if (!status) return;
  const { admin, supplier, companyId, transactionId, projectId } = await seedShared(page, status, true);

  await page.goto("/review");
  await expect(page.getByRole("heading", { name: supplier })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "אישור", exact: true }).click();
  await expect(page.getByRole("heading", { name: "פיצול", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "לאשר בלי פיצול" }).click();
  await expect(page.getByText("אושר בלי פיצול")).toBeVisible();

  const line = await admin.from("transactions").select("pnl_role, project_id").eq("id", transactionId).single();
  expect(line.data).toEqual({ pnl_role: "project", project_id: projectId });
  const closed = await admin.from("review_queue").select("status, reason").eq("transaction_id", transactionId);
  expect(closed.data).toEqual([{ status: "changed", reason: "unallocated_shared" }]);
  const synced = await admin.rpc("sync_review_queue", { p_company_id: companyId });
  expect(synced.error, synced.error?.message).toBeNull();
  const open = await admin.from("review_queue").select("id").eq("transaction_id", transactionId).eq("status", "open");
  expect(open.data).toEqual([]);
});
