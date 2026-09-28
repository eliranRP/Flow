import { createClient } from "@supabase/supabase-js";
import { empty, json } from "../_shared/http.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

interface OutboxRow {
  id: string;
  company_id: string;
  title: string;
  body: string;
  url: string;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth_secret: string;
}

// VAPID Web Push. No paid gateway. Secrets stay in the function environment.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "";
  if (!url || !anon || !service) return json({ error: "server is missing a secret" }, 500);

  const cron = req.headers.get("x-flow-cron");
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let companyId: string | null = null;
  if (!(cron && cronSecret && cron === cronSecret)) {
    const header = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: header } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const user = await userClient.auth.getUser();
    if (user.error || !user.data.user) return json({ error: "unauthorized" }, 401);
    const company = await admin.from("companies").select("id").eq("owner_id", user.data.user.id).maybeSingle();
    if (company.error || !company.data) return json({ error: "no company" }, 400);
    companyId = company.data.id as string;
  }

  let query = admin.from("notification_outbox").select("id, company_id, title, body, url").eq("status", "pending").limit(20);
  if (companyId) query = query.eq("company_id", companyId);
  const pending = await query;
  if (pending.error) return json({ error: "could not read the outbox" }, 500);
  const rows = (pending.data ?? []) as OutboxRow[];
  if (!publicKey || !privateKey || !subject) {
    return json({ ok: true, sent: 0, pending: rows.length, reason: "unconfigured" });
  }

  const webpush = await import("npm:web-push@3.6.7");
  webpush.default.setVapidDetails(subject, publicKey, privateKey);
  let sent = 0;
  for (const row of rows) {
    const subs = await admin
      .from("push_subscription")
      .select("endpoint, p256dh, auth_secret")
      .eq("company_id", row.company_id);
    const targets = (subs.data ?? []) as SubscriptionRow[];
    if (targets.length === 0) continue;
    let delivered = false;
    for (const sub of targets) {
      try {
        await webpush.default.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_secret } },
          JSON.stringify({ title: row.title, body: row.body, url: row.url }),
        );
        delivered = true;
      } catch (error) {
        const status = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
        if (status === 404 || status === 410) {
          await admin.from("push_subscription").delete().eq("endpoint", sub.endpoint);
        }
      }
    }
    if (delivered) {
      await admin
        .from("notification_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);
      sent += 1;
    }
  }
  return json({ ok: true, sent, pending: rows.length });
});
