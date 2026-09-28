import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

function envValue(name: string): string {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;
  try {
    const text = readFileSync(new URL("../../supabase/.env", import.meta.url), "utf8");
    const line = text.split("\n").find((row) => row.startsWith(`${name}=`));
    if (!line) return "";
    return line.slice(name.length + 1).trim().replace(/^"|"$/g, "");
  } catch {
    return "";
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || envValue("SUPABASE_URL") || "http://127.0.0.1:54321";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envValue("SUPABASE_SERVICE_ROLE_KEY");
const cronSecret = process.env.CRON_SECRET || envValue("CRON_SECRET");

test("the cron drain opens the sync path and rejects a bad secret", async () => {
  expect(serviceKey, "SUPABASE_SERVICE_ROLE_KEY is required").not.toBe("");
  expect(cronSecret, "CRON_SECRET is required").not.toBe("");

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `flow-drain-${String(Date.now())}@example.com`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  const userId = created.data.user?.id;
  expect(userId, created.error?.message).toBeTruthy();
  if (!userId) return;

  const company = await admin.from("companies").insert({ owner_id: userId, name: "בדיקת ניקוז" }).select("id").single();
  expect(company.error, company.error?.message).toBeNull();
  const companyId = company.data?.id as string;

  const connection = await admin.from("sumit_connections").insert({
    company_id: companyId,
    sumit_company_id: 1,
    key_ciphertext: "\\x01",
    key_nonce: "\\x02",
    dek_ciphertext: "\\x03",
    dek_nonce: "\\x04",
    kek_version: "1",
    last_sync_at: null,
  }).select("company_id");
  expect(connection.error, connection.error?.message).toBeNull();

  const marker = await admin.from("sumit_refresh_requests").insert({ company_id: companyId }).select("id").single();
  expect(marker.error, marker.error?.message).toBeNull();
  const markerId = marker.data?.id as number;

  const wrong = await fetch(`${supabaseUrl}/functions/v1/sumit-sync`, {
    method: "POST",
    headers: { "x-flow-cron": "not-the-secret", "content-type": "application/json" },
    body: "{}",
  });
  expect(wrong.status).toBe(401);

  const empty = await fetch(`${supabaseUrl}/functions/v1/sumit-sync`, {
    method: "POST",
    headers: { "x-flow-cron": "", "content-type": "application/json" },
    body: "{}",
  });
  expect(empty.status).toBe(401);

  const untouched = await admin.from("sumit_refresh_requests").select("claimed_at").eq("id", markerId).single();
  expect(untouched.data?.claimed_at).toBeNull();

  const response = await fetch(`${supabaseUrl}/functions/v1/sumit-sync`, {
    method: "POST",
    headers: { "x-flow-cron": cronSecret, "content-type": "application/json" },
    body: "{}",
  });
  expect(response.status, await response.text()).toBe(200);

  const claimed = await admin.from("sumit_refresh_requests").select("claimed_at").eq("id", markerId).single();
  expect(claimed.error, claimed.error?.message).toBeNull();
  expect(claimed.data?.claimed_at).toBeNull();

  const stored = await admin.from("sumit_connections").select("last_error").eq("company_id", companyId).single();
  expect(stored.error, stored.error?.message).toBeNull();
  expect(stored.data?.last_error).toBe("sync_failed");
});
