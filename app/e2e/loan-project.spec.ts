import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

// FLOW-119. Pick, change and clear a loan's project.
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

async function pickProject(page: Page, name: string) {
  await page.getByRole("radio", { name, exact: true }).click();
}

test("the new-loan picker swaps in place, and Escape goes back to the form", async ({ page }) => {
  await page.goto("/e2e/settings");
  await page.getByRole("button", { name: "הלוואה חדשה" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "הלוואה" })).toBeVisible();
  await sheet.getByLabel("מלווה").fill("הלוואת דוגמה");
  await sheet.getByRole("button", { name: "פרויקט ללא פרויקט" }).click();
  await expect(sheet.getByRole("heading", { name: "פרויקט" })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "ללא פרויקט" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("heading", { name: "הלוואה" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "פרויקט ללא פרויקט" })).toBeFocused();
  await sheet.getByRole("button", { name: "פרויקט ללא פרויקט" }).click();
  await pickProject(page, "שיפוץ הרצל 12");
  await expect(sheet.getByRole("heading", { name: "הלוואה" })).toBeVisible();
  await expect(sheet.getByLabel("מלווה")).toHaveValue("הלוואת דוגמה");
  await expect(sheet.getByRole("button", { name: "פרויקט שיפוץ הרצל 12" })).toBeVisible();
});

test("a loan's project is set, changed and cleared, and shows on the project", async ({ page }) => {
  const status = localStatus();
  test.skip(!status, "local Supabase is required to save a loan");
  if (!status) return;

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const lender = `מלווה ${stamp}`;
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email: `loan-${stamp}@test.flow`, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const user = created.data.user;
  expect(user).not.toBeNull();
  if (!user) return;
  const signed = ownerSession(status.jwt, status.anon, user);
  const anon = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const applied = await anon.auth.setSession({ access_token: signed.access_token, refresh_token: signed.refresh_token });
  expect(applied.error, applied.error?.message).toBeNull();

  const company = await anon.rpc("create_company", { p_name: `הלוואות ${stamp}`, p_vat_registered: true });
  expect(company.error, company.error?.message).toBeNull();
  const first = await anon.rpc("upsert_project", { p_name: "פרויקט א", p_status: "active" });
  expect(first.error, first.error?.message).toBeNull();
  const second = await anon.rpc("upsert_project", { p_name: "פרויקט ב", p_status: "active" });
  expect(second.error, second.error?.message).toBeNull();
  const companyId = company.data as string;
  const projectA = first.data as string;
  const projectB = second.data as string;

  const host = new URL(status.url).hostname.split(".")[0] ?? "local";
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: `sb-${host}-auth-token`, value: signed });

  async function storedProject(): Promise<string | null | undefined> {
    const row = await admin.from("loans").select("project_id").eq("company_id", companyId).eq("name", lender).maybeSingle();
    expect(row.error, row.error?.message).toBeNull();
    return row.data == null ? undefined : (row.data.project_id as string | null);
  }

  await page.goto("/settings");
  await page.getByRole("button", { name: "הלוואה חדשה" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("מלווה").fill(lender);
  await sheet.getByLabel("סכום מקורי").fill("100000");
  await sheet.getByLabel("ריבית שנתית").fill("6");
  await sheet.getByRole("button", { name: "פרויקט ללא פרויקט" }).click();
  await pickProject(page, "פרויקט א");
  await sheet.getByRole("button", { name: "שמירה" }).click();
  await expect(page.getByRole("status").filter({ hasText: "ההלוואה נשמרה" })).toBeVisible();
  await expect.poll(storedProject).toBe(projectA);
  const row = page.getByRole("button", { name: new RegExp(`^${lender}, .*פרויקט: פרויקט א$`) });
  await expect(row).toBeVisible();

  await page.goto(`/projects/${projectA}`);
  await expect(page.getByRole("heading", { name: "הלוואות" })).toBeVisible();
  await expect(page.getByText(lender)).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: new RegExp(`^${lender}, .*פרויקט: פרויקט א$`) }).click();
  await pickProject(page, "פרויקט ב");
  await expect(page.getByRole("status").filter({ hasText: "ההלוואה שויכה לפרויקט" })).toBeVisible();
  await expect.poll(storedProject).toBe(projectB);

  await page.getByRole("button", { name: new RegExp(`^${lender}, .*פרויקט: פרויקט ב$`) }).click();
  await pickProject(page, "ללא פרויקט");
  await expect(page.getByRole("status").filter({ hasText: "ההלוואה הוסרה מהפרויקט" })).toBeVisible();
  await expect.poll(storedProject).toBeNull();
  await expect(page.getByRole("button", { name: new RegExp(`^${lender}, .*פרויקט: ללא פרויקט$`) })).toBeVisible();

  await page.goto(`/projects/${projectB}`);
  await expect(page.getByRole("heading", { name: "הוצאות לפי קטגוריה" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "הלוואות" })).toHaveCount(0);
});
