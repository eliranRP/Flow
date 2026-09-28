import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sumitCompanyId = Number(process.env.SUMIT_COMPANY_ID ?? "");
const sumitKey = process.env.SUMIT_API_KEY ?? "";
const jwtSecret = process.env.JWT_SECRET ?? "";
const live = process.env.SUMIT_LIVE === "1" && supabaseUrl && anonKey && serviceKey && jwtSecret && sumitKey && sumitCompanyId > 0;

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

async function sumit(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
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
  const probe = `FLOW-PROBE-${String(Date.now())}`;
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

  await page.goto("/settings");
  await page.getByLabel("CompanyID").fill(String(sumitCompanyId));
  await page.getByLabel("מפתח API").fill(sumitKey);
  await page.getByRole("button", { name: "חיבור" }).click();
  await expect(page.getByText("SUMIT מחובר")).toBeVisible();

  await sync(page);
  await showInvoicedAllTime(page);
  await expect(page.getByRole("heading", { name: /37,700/ })).toBeVisible();
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "פרויקטים" })).toBeVisible();
  await expect(page.getByText("שיפוץ הרצל 12")).toBeVisible();
  await page.goto("/unpaid");
  await expect(page.getByText("134,520")).toBeVisible();

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
    await page.goto("/settings");
    await sync(page);
    await page.goto("/unpaid");
    await expect(page.getByText(probe)).toBeVisible();
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
      await page.goto("/settings");
      await sync(page);
      await showInvoicedAllTime(page);
      await expect(page.getByRole("heading", { name: /37,700/ })).toBeVisible();
      await page.goto("/unpaid");
      await expect(page.getByText("134,520")).toBeVisible();
      await expect(page.getByText(probe)).toHaveCount(0);
    }
  }
});

async function sync(page: Page) {
  const pending = page.waitForResponse((response) => response.url().includes("/functions/v1/sumit-sync"));
  await page.getByRole("button", { name: "רענון עכשיו" }).click();
  const response = await pending;
  const body = (await response.json()) as { ok?: boolean; skipped?: boolean; error?: string };
  expect(response.ok(), body.error ?? "sync failed").toBe(true);
  expect(body.skipped).not.toBe(true);
  await expect(page.getByText("הרענון הסתיים.")).toBeVisible();
}

async function showInvoicedAllTime(page: Page) {
  await page.goto("/");
  const sheet = page.getByRole("dialog", { name: "תקופה" });
  await page.getByRole("button", { name: "החודש" }).click();
  await sheet.getByRole("radio", { name: "כל התקופה" }).click();
  await expect(sheet).toBeHidden();
}
