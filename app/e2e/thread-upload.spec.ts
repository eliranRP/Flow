// FLOW-957: a file from the approval sheet goes up to the transaction-files bucket and is recorded on
// the line. The build leaves supabase-js's storage client out (FLOW-804), so this runs the real upload
// against local Supabase. Invented names only.
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

/** A fresh owner with one open expense review, signed in on the page (the review-field-save seed). */
async function seedOwner(page: Page, status: NonNullable<ReturnType<typeof localStatus>>) {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const supplier = `ספק קובץ ${stamp}`;
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email: `thread-${stamp}@test.flow`, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const user = created.data.user;
  if (!user) throw new Error("no user");
  const session = ownerSession(status.jwt, status.anon, user);
  const anon = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const applied = await anon.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  expect(applied.error, applied.error?.message).toBeNull();

  const company = await anon.rpc("create_company", { p_name: `קובץ ${stamp}`, p_vat_registered: true });
  expect(company.error, company.error?.message).toBeNull();
  const txn = await admin.from("transactions").insert({
    company_id: company.data as string,
    direction: "expense",
    doc_kind: "expense",
    pnl_role: "overhead",
    amount_gross: -10000,
    amount_net: -10000,
    amount_original: 10000,
    vat_amount: 0,
    vat_status: "unknown",
    doc_date: "2026-09-28",
    source: "manual",
    idempotency_key: `thread-e2e:${stamp}`,
    description: supplier,
    user_assigned: false,
  }).select("id").single();
  expect(txn.error, txn.error?.message).toBeNull();
  const transactionId = txn.data?.id as string;
  const review = await admin.from("review_queue").insert({
    company_id: company.data as string,
    transaction_id: transactionId,
    status: "open",
    reason: "missing_category",
  });
  expect(review.error, review.error?.message).toBeNull();

  const host = new URL(status.url).hostname.split(".")[0] ?? "local";
  const stored: Session = session;
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: `sb-${host}-auth-token`, value: stored });

  return { admin, supplier, transactionId };
}

test("a photo saved from the approval sheet, with no note, reaches storage and the thread (FLOW-957)", async ({ page }) => {
  const status = localStatus();
  test.skip(!status, "local Supabase is required for the real upload");
  if (!status) return;
  const { admin, supplier, transactionId } = await seedOwner(page, status);
  const uploads: number[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/storage/v1/object/transaction-files/")) uploads.push(response.status());
  });

  await page.goto("/review");
  await expect(page.getByRole("heading", { name: supplier })).toBeVisible();
  await page.getByRole("button", { name: "הוספת הערה או קובץ" }).click();
  await page.locator("input[type=file][multiple]").setInputFiles({
    name: "IMG_6895.jpeg",
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(200_000, 7),
  });
  await expect(page.getByText("IMG_6895.jpeg")).toBeVisible();
  await page.getByRole("button", { name: "רק לשמור" }).click();
  await expect(page.locator(".ui-review-thread")).toHaveText("קובץ");
  await expect(page.getByText("ההערה לא נשמרה")).toHaveCount(0);

  expect(uploads).toEqual([200]);
  const files = await admin.from("transaction_files").select("file_name, mime, note_id").eq("transaction_id", transactionId);
  expect(files.data).toEqual([{ file_name: "IMG_6895.jpeg", mime: "image/jpeg", note_id: null }]);
  const notes = await admin.from("transaction_notes").select("id").eq("transaction_id", transactionId);
  expect(notes.data).toEqual([]);
});
