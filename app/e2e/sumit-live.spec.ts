import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { formatIls } from "@flow/shared";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sumitCompanyId = Number(process.env.SUMIT_COMPANY_ID ?? "");
const sumitKey = process.env.SUMIT_API_KEY ?? "";
const jwtSecret = process.env.JWT_SECRET ?? "";
const live = process.env.SUMIT_LIVE === "1" && supabaseUrl && anonKey && serviceKey && jwtSecret && sumitKey && sumitCompanyId > 0;

type WorkerFixture = {
  projects: Record<string, { name: string }>;
  shared_alloc_worker_days: Record<string, Record<string, number>>;
};

const workerFixture: WorkerFixture = JSON.parse(
  readFileSync(new URL("../../packages/shared/fixtures/demo-data.json", import.meta.url), "utf8"),
) as WorkerFixture;

test.skip(!live, "Set SUMIT_LIVE=1 and the local Supabase and SUMIT env vars.");

const storageHost = new URL(supabaseUrl.length > 0 ? supabaseUrl : "http://127.0.0.1").hostname.split(".")[0] ?? "local";
const storageKey = `sb-${storageHost}-auth-token`;

function signUserToken(userId: string, email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      aud: "authenticated",
      exp: now + 3600,
      iat: now,
      iss: "supabase-demo",
      sub: userId,
      role: "authenticated",
      email,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: { full_name: "בדיקה" },
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const signature = createHmac("sha256", jwtSecret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

async function sessionForNewOwner(): Promise<Record<string, unknown>> {
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `flow-live-${String(Date.now())}@example.com`;
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: "בדיקה" },
  });
  const user = created.data.user;
  if (user == null) throw new Error("could not create the owner");
  const accessToken = signUserToken(user.id, email);
  return {
    access_token: accessToken,
    refresh_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
}

const READ_PATHS = new Set([
  "/crm/schema/listfolders/",
  "/crm/data/listentities/",
  "/website/companies/listquotas/",
]);
const writesEnabled = process.env.SUMIT_CREATE_DOCUMENTS === "1";
const sumitCounts = { reads: 0, writes: 0 };
let serverReads = 0;

async function sumit(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const read = READ_PATHS.has(path);
  if (!read && !writesEnabled) throw new Error(`SUMIT write is not enabled: ${path}`);
  if (read) sumitCounts.reads += 1;
  else sumitCounts.writes += 1;
  const response = await fetch(`https://api.sumit.co.il${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      Credentials: { CompanyID: sumitCompanyId, APIKey: sumitKey },
      ...body,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`SUMIT HTTP ${String(response.status)}`);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (parsed.Status !== 0) {
    const message = typeof parsed.UserErrorMessage === "string" ? parsed.UserErrorMessage : "SUMIT rejected the call";
    throw new Error(message);
  }
  return parsed;
}

function operationsUsed(payload: Record<string, unknown>): number {
  const data = payload.Data;
  const nested = data != null && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>).Data
    : data;
  const rows = Array.isArray(nested) ? nested : [];
  const match = rows.find((row) => {
    if (row == null || typeof row !== "object") return false;
    const record = row as Record<string, unknown>;
    return record.ApplicationName === "ActionsBilling" && record.StatisticName === "Operations";
  }) as Record<string, unknown> | undefined;
  const usage = match?.Usage;
  if (typeof usage !== "number") throw new Error("SUMIT did not report Operations");
  return usage;
}

function entityList(data: unknown): Array<{ ID?: number; Folder?: unknown }> {
  const record = data != null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const rows = Array.isArray(data) ? data : Array.isArray(record?.Entities) ? record.Entities : [];
  return rows.filter((row): row is { ID?: number; Folder?: unknown } => row != null && typeof row === "object");
}

function folderId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

async function linkCredit(creditId: number, invoiceId: number): Promise<void> {
  const listed = await sumit("/crm/data/listentities/", {
    Folder: 2375135516,
    IncludeInheritedFolders: true,
    LoadProperties: true,
    Paging: { StartIndex: 0, PageSize: 1000 },
  });
  const entities = entityList(listed.Data);
  const credit = entities.find((entity) => entity.ID === creditId);
  const folder = folderId(credit?.Folder);
  if (folder == null) throw new Error("could not find the credit folder");
  await sumit("/crm/data/updateentity/", {
    Entity: { ID: creditId, Folder: folder, Properties: { Accounting_OriginalDocument: invoiceId } },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function rowsOf(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error("expected rows");
  return value.filter((row): row is Record<string, unknown> => isRecord(row));
}

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`missing ${key}`);
  return value;
}

async function ownerRest(token: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) body = JSON.parse(text) as unknown;
  if (!response.ok) {
    const message = isRecord(body) && typeof body.message === "string" ? body.message : "owner request failed";
    throw new Error(message);
  }
  return body;
}

async function markInsuranceExempt(token: string): Promise<void> {
  const suppliers = rowsOf(await ownerRest(token, "suppliers?select=id,name&name=ilike.*ביטוח המגן*"));
  const supplier = suppliers[0];
  if (!supplier) throw new Error("insurance supplier was not imported");
  await ownerRest(token, "rpc/set_supplier_settings", {
    method: "POST",
    body: JSON.stringify({ p_id: textField(supplier, "id"), p_vat_exempt: true }),
  });
}

async function enterWorkerSplit(token: string): Promise<string> {
  const shared = rowsOf(
    await ownerRest(token, "transactions?select=id,doc_date&pnl_role=eq.shared&removed_at=is.null&order=doc_date.asc"),
  );
  const row = shared.find((item) => {
    const month = textField(item, "doc_date").slice(0, 7);
    return Object.keys(workerFixture.shared_alloc_worker_days[month] ?? {}).length > 1;
  });
  if (!row) throw new Error("no shared cost to split");
  const month = textField(row, "doc_date").slice(0, 7);
  const days = workerFixture.shared_alloc_worker_days[month];
  if (!days) throw new Error(`no worker days for ${month}`);
  const projects = rowsOf(await ownerRest(token, "projects?select=id,name"));
  const entries = Object.entries(days).map(([key, weight]) => {
    const name = workerFixture.projects[key]?.name;
    const project = projects.find((item) => textField(item, "name") === name);
    if (!project) throw new Error(`project ${name ?? key} was not imported`);
    return { project_id: textField(project, "id"), weight };
  });
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let used = 0;
  const shares = entries.map((entry, index) => {
    const share = index === entries.length - 1 ? 10000 - used : Math.round((entry.weight / total) * 10000);
    used += share;
    return { project_id: entry.project_id, share_bp: share };
  });
  await ownerRest(token, "rpc/save_split", {
    method: "POST",
    body: JSON.stringify({ p_transaction_id: textField(row, "id"), p_shares: shares }),
  });
  return textField(row, "id");
}

async function expectSplitSurvived(token: string, transactionId: string): Promise<void> {
  const txn = rowsOf(
    await ownerRest(token, `transactions?select=user_assigned,pnl_role&id=eq.${transactionId}`),
  )[0];
  if (!txn) throw new Error("split transaction missing");
  expect(txn.user_assigned).toBe(true);
  expect(txn.pnl_role).toBe("shared");
  const allocations = rowsOf(
    await ownerRest(token, `allocations?select=share_bp&transaction_id=eq.${transactionId}`),
  );
  const sum = allocations.reduce((total, item) => total + Number(item.share_bp), 0);
  expect(sum).toBe(10000);
}

function documentId(payload: Record<string, unknown>): number {
  const data = payload.Data;
  if (!data || typeof data !== "object") throw new Error("SUMIT create returned no document");
  const id = (data as { DocumentID?: unknown }).DocumentID;
  if (typeof id !== "number") throw new Error("SUMIT create returned no document id");
  return id;
}

test("live SUMIT backfill matches the golden totals and a new invoice syncs", async ({ page }) => {
  test.setTimeout(360_000);
  const session = await sessionForNewOwner();
  const token = String(session.access_token);
  const probe = `FLOW-PROBE-${String(Date.now())}`;
  let splitId = "";
  let createdId: number | null = null;
  let creditId: number | null = null;

  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: storageKey,
      value: session,
    },
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/onboarding");
  await page.getByLabel("שם העסק").fill("Flow Test");
  await page.getByRole("button", { name: "המשך" }).click();
  await expect(page.getByText("עוד אין נתונים")).toBeVisible();

  const operationsBefore = operationsUsed(await sumit("/website/companies/listquotas/", {}));

  await page.goto("/settings/connections");
  await page.getByRole("button", { name: "SUMIT" }).click();
  await page.getByLabel("מספר חברה").fill(String(sumitCompanyId));
  await page.getByLabel("מפתח API").fill(sumitKey);
  const connecting = page.waitForResponse((response) => response.url().includes("/functions/v1/sumit-connect"));
  await page.getByRole("button", { name: "חיבור" }).click();
  const connected = await connecting;
  const connectBody = (await connected.json()) as { error?: string; sumit_reads?: number };
  expect(connected.ok(), connectBody.error ?? "connect failed").toBe(true);
  if (typeof connectBody.sumit_reads !== "number") throw new Error("connect did not report its SUMIT reads");
  serverReads += connectBody.sumit_reads;
  await expect(page.getByText("SUMIT מחובר. המפתח נשאר בשרת.")).toBeVisible();

  await sync(page);
  await markInsuranceExempt(token);
  await page.goto("/");
  await showInvoicedAllTime(page);
  await expect(page.getByRole("heading", { name: /37,700/ })).toBeVisible();
  splitId = await enterWorkerSplit(token);
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "פרויקטים" })).toBeVisible();
  await expect(page.getByText("שיפוץ הרצל 12")).toBeVisible();
  await page.goto("/unpaid");
  await expect(page.getByText("134,520")).toBeVisible();

  if (process.env.SUMIT_CREATE_DOCUMENTS === "1") {
    try {
      const created = await sumit("/accounting/documents/create/", {
        Details: {
          Type: 0,
          Date: new Date().toISOString().slice(0, 10),
          Language: 0,
          Currency: 0,
          Description: probe,
          Customer: { Name: 'יזמות הגליל בע"מ', SearchMode: 0 },
        },
        Items: [{ Item: { Name: probe, Price: 118 }, Quantity: 1, UnitPrice: 118 }],
      });
      createdId = documentId(created);
      await page.waitForTimeout(61_000);
      await page.goto("/settings/connections");
      await sync(page);
      await expectProbeListed(page, token, probe);
      await expectSplitSurvived(token, splitId);
    } finally {
      if (createdId != null) {
        const credited = await sumit("/accounting/documents/create/", {
          Details: {
            Type: 5,
            Date: new Date().toISOString().slice(0, 10),
            Language: 0,
            Currency: 0,
            Description: `${probe}-credit`,
            Customer: { Name: 'יזמות הגליל בע"מ', SearchMode: 0 },
          },
          Items: [{ Item: { Name: `${probe}-credit`, Price: 118 }, Quantity: 1, UnitPrice: 118 }],
        });
        creditId = documentId(credited);
        await linkCredit(creditId, createdId);
        await page.waitForTimeout(61_000);
        await page.goto("/settings/connections");
        await sync(page);
        await showInvoicedAllTime(page);
        await expect(page.getByRole("heading", { name: /37,700/ })).toBeVisible();
        await expectProbeAbsent(page, token, probe);
        await expectSplitSurvived(token, splitId);
      }
    }
    return;
  }

  await page.waitForTimeout(61_000);
  await page.goto("/settings/connections");
  await sync(page);
  await showInvoicedAllTime(page);
  await expect(page.getByRole("heading", { name: /37,700/ })).toBeVisible();
  await page.goto("/unpaid");
  await expect(page.getByText("134,520")).toBeVisible();
  await expectSplitSurvived(token, splitId);
  const operationsAfter = operationsUsed(await sumit("/website/companies/listquotas/", {}));
  expect(sumitCounts.writes).toBe(0);
  expect(sumitCounts.reads).toBe(2);
  expect(serverReads).toBe(5);
  expect(operationsAfter).toBe(operationsBefore);
});

async function unpaidRows(token: string): Promise<Array<Record<string, unknown>>> {
  const body = await ownerRest(token, "rpc/list_unpaid", { method: "POST", body: "{}" });
  return rowsOf(body);
}

function openGross(row: Record<string, unknown>): bigint {
  const value = row.open_gross_agorot;
  if (typeof value === "number" || typeof value === "string") return BigInt(value);
  throw new Error("missing open_gross_agorot");
}

/** The row title is the customer. The probe lives on the document description, so the page total is the visible proof. */
async function expectProbeListed(page: Page, token: string, probe: string): Promise<void> {
  const rows = await unpaidRows(token);
  expect(rows.some((row) => textField(row, "description") === probe)).toBe(true);
  const total = rows.reduce((sum, row) => sum + openGross(row), 0n);
  await page.goto("/unpaid");
  await expect(page.getByText(formatIls(total).replace("₪", ""))).toBeVisible();
}

async function expectProbeAbsent(page: Page, token: string, probe: string): Promise<void> {
  const rows = await unpaidRows(token);
  expect(rows.some((row) => textField(row, "description") === probe)).toBe(false);
  await page.goto("/unpaid");
  await expect(page.getByText("134,520")).toBeVisible();
  await expect(page.getByText(probe)).toHaveCount(0);
}

async function sync(page: Page) {
  const pending = page.waitForResponse((response) => response.url().includes("/functions/v1/sumit-sync"));
  const dialog = page.getByRole("dialog", { name: "SUMIT", exact: true });
  if (await dialog.count() === 0) await page.getByRole("button", { name: "SUMIT" }).click();
  await dialog.getByRole("button", { name: "רענון עכשיו" }).click();
  const response = await pending;
  const body = (await response.json()) as { ok?: boolean; skipped?: boolean; error?: string; sumit_reads?: number };
  expect(response.ok(), body.error ?? "sync failed").toBe(true);
  expect(body.skipped).not.toBe(true);
  if (typeof body.sumit_reads !== "number") throw new Error("sync did not report its SUMIT reads");
  serverReads += body.sumit_reads;
  await expect(page.getByText("הרענון הסתיים.")).toBeVisible();
}

async function showInvoicedAllTime(page: Page) {
  await page.goto("/");
  // The period bar's הכול preset (decision 0135) is one tap.
  const all = page.locator(".ui-band").getByRole("radio", { name: "הכול" });
  await all.click();
  await expect(all).toHaveAttribute("aria-checked", "true");
}
