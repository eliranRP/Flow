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
const ready = supabaseUrl.length > 0 && serviceKey.length > 0 && cronSecret.length > 0;

test.skip(!ready, "Set CRON_SECRET and the local service role before the drain check.");

test("the cron drain claims a refresh row", async () => {
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
    last_sync_at: new Date().toISOString(),
  }).select("company_id");
  expect(connection.error, connection.error?.message).toBeNull();

  const marker = await admin.from("sumit_refresh_requests").insert({ company_id: companyId }).select("id").single();
  expect(marker.error, marker.error?.message).toBeNull();
  const markerId = marker.data?.id as number;

  const response = await fetch(`${supabaseUrl}/functions/v1/sumit-sync`, {
    method: "POST",
    headers: { "x-flow-cron": cronSecret, "content-type": "application/json" },
    body: "{}",
  });
  expect(response.status, await response.text()).toBe(200);

  const claimed = await admin.from("sumit_refresh_requests").select("claimed_at").eq("id", markerId).single();
  expect(claimed.error, claimed.error?.message).toBeNull();
  expect(claimed.data?.claimed_at).toBeTruthy();
});
