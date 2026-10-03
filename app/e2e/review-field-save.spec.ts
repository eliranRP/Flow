import { createClient, type Session } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

function localStatus(): { url: string; anon: string; service: string } | null {
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
    if (!url.startsWith("http://127.0.0.1:") && !url.startsWith("http://localhost:")) return null;
    if (!anon || !service) return null;
    return { url, anon, service };
  } catch {
    return null;
  }
}

test("a card-line category pick stays on the card and shows the new value", async ({ page }) => {
  const status = localStatus();
  test.skip(!status, "local Supabase is required for the real review save");
  if (!status) return;

  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `field-${stamp}@test.flow`;
  const password = `field-${stamp}-pass`;
  const supplier = `ספק שדה ${stamp}`;
  const other = `ספק הבא ${stamp}`;
  const admin = createClient(status.url, status.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error, created.error?.message).toBeNull();
  const anon = createClient(status.url, status.anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await anon.auth.signInWithPassword({ email, password });
  expect(signed.error, signed.error?.message).toBeNull();
  const session = signed.data.session;
  expect(session).not.toBeNull();
  if (!session) return;

  const company = await anon.rpc("create_company", { p_name: `שדה ${stamp}`, p_vat_registered: true });
  expect(company.error, company.error?.message).toBeNull();
  const project = await anon.rpc("upsert_project", { p_name: "הרצל", p_status: "active" });
  expect(project.error, project.error?.message).toBeNull();
  const categories = await anon.rpc("list_categories");
  expect(categories.error, categories.error?.message).toBeNull();
  const rows = Array.isArray(categories.data)
    ? categories.data as Array<{ id: string; name: string; kind: string }>
    : [];
  const materials = rows.find((row) => row.name === "חומרים" && row.kind === "expense");
  const haul = rows.find((row) => row.name === "הובלה" && row.kind === "expense");
  expect(materials?.id).toBeTruthy();
  expect(haul?.id).toBeTruthy();
  const companyId = company.data as string;
  const projectId = project.data as string;

  async function insertOpen(description: string, idempotency: string, docDate: string) {
    const txn = await admin.from("transactions").insert({
      company_id: companyId,
      direction: "expense",
      doc_kind: "expense",
      pnl_role: "project",
      amount_gross: -10000,
      amount_net: -10000,
      vat_amount: 0,
      vat_status: "unknown",
      doc_date: docDate,
      source: "manual",
      idempotency_key: idempotency,
      project_id: projectId,
      category_id: materials?.id,
      description,
      user_assigned: false,
    }).select("id").single();
    expect(txn.error, txn.error?.message).toBeNull();
    const review = await admin.from("review_queue").insert({
      company_id: companyId,
      transaction_id: txn.data?.id,
      status: "open",
      reason: "missing_category",
    }).select("id").single();
    expect(review.error, review.error?.message).toBeNull();
    return review.data?.id as string;
  }

  const reviewId = await insertOpen(supplier, `field-e2e:${stamp}`, "2026-09-28");
  await insertOpen(other, `field-e2e-next:${stamp}`, "2026-09-29");

  const host = new URL(status.url).hostname.split(".")[0] ?? "local";
  const storageKey = `sb-${host}-auth-token`;
  const stored: Session = session;
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: stored });

  await page.goto("/review");
  await expect(page.getByRole("heading", { name: supplier })).toBeVisible();
  await page.getByRole("button", { name: /קטגוריה:/ }).click();
  await page.getByRole("radio", { name: "הובלה" }).click();
  await expect(page.getByRole("heading", { name: supplier })).toBeVisible();
  await expect(page.getByRole("button", { name: "קטגוריה: הובלה" })).toBeVisible();
  await expect(page.getByRole("heading", { name: other })).toHaveCount(0);
  const toast = page.locator(".ui-toast");
  await expect(toast).toContainText("השיוך נשמר");
  const toastBox = await toast.boundingBox();
  const headerBox = await page.locator("header.ui-page, header.ui-band").first().boundingBox();
  const tabBox = await page.locator(".ui-tabbar").boundingBox();
  expect(toastBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(tabBox).not.toBeNull();
  if (toastBox && headerBox && tabBox) {
    expect(toastBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
    expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(tabBox.y + 1);
  }

  const saved = await admin.from("review_queue").select("status").eq("id", reviewId).single();
  expect(saved.data?.status).toBe("open");
  const txn = await admin.from("transactions").select("category_id").eq("idempotency_key", `field-e2e:${stamp}`).single();
  expect(txn.data?.category_id).toBe(haul?.id);
});
