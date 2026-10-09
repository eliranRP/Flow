// FLOW-502: the push-send function. The flow-push-evening cron calls it at 20:00 Israel time when
// someone is due; it reminds each owner who opted in and has open review lines, once a day.
// The count in the message comes from SQL (decision 0084). Nothing here changes the books.

import { empty, json } from "./http.ts";
import { serviceRoleKey, tagCallerKind } from "./jev_tag.ts";
import { sendPush, type PushOutcome, type PushTarget, type VapidKeys } from "./webpush.ts";

export interface PushSendDeps {
  fetch: typeof fetch;
  env: (name: string) => string;
  now?: () => Date;
}

export interface EveningTarget extends PushTarget {
  user_id: string;
  waiting: number;
}

export interface PushReport {
  users: number;
  sent: number;
  gone: number;
  failed: number;
}

/** The evening reminder, in the shape the app's service worker reads (title, body, url, tag). */
export function eveningMessage(waiting: number): { title: string; body: string; url: string; tag: string } {
  const body = waiting === 1 ? "תנועה אחת מחכה לאישור" : `${waiting} תנועות מחכות לאישור`;
  return { title: "תזכורת ערב", body, url: "/review", tag: "evening-reminder" };
}

export function readVapid(env: (name: string) => string): VapidKeys | null {
  const keys = {
    publicKey: env("VAPID_PUBLIC_KEY").trim(),
    privateKey: env("VAPID_PRIVATE_KEY").trim(),
    subject: env("VAPID_SUBJECT").trim(),
  };
  if (!keys.publicKey || !keys.privateKey || !/^(mailto:|https:\/\/)/.test(keys.subject)) return null;
  return keys;
}

function parseTargets(data: unknown): EveningTarget[] {
  if (!Array.isArray(data)) throw new Error("push_targets");
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (
      typeof item.user_id !== "string" || typeof item.endpoint !== "string" ||
      typeof item.p256dh !== "string" || typeof item.auth !== "string" ||
      typeof item.waiting !== "number" || !Number.isInteger(item.waiting) || item.waiting < 1
    ) return [];
    return [{
      user_id: item.user_id,
      endpoint: item.endpoint,
      p256dh: item.p256dh,
      auth: item.auth,
      waiting: item.waiting,
    }];
  });
}

/** Sends at once, at most this many. Each send has its own timeout (webpush.ts). */
export const PUSH_CONCURRENCY = 8;
/**
 * No new send starts after this, so the results are recorded inside the function's time limit.
 * This plus one send's timeout (10s in webpush.ts) must stay well under that limit.
 */
export const PUSH_BUDGET_MS = 90_000;

/**
 * Sends to every device of each due user; a user counts as reminded when one device took it.
 * A send not started before the budget runs out is left for the next day, and counted as failed.
 */
export async function remindEvening(
  targets: readonly EveningTarget[],
  send: (target: EveningTarget) => Promise<PushOutcome>,
  options: { now?: () => number; budgetMs?: number; concurrency?: number } = {},
): Promise<{ report: PushReport; reminded: string[]; gone: string[] }> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? PUSH_BUDGET_MS);
  const report: PushReport = { users: new Set(targets.map((target) => target.user_id)).size, sent: 0, gone: 0, failed: 0 };
  const reminded = new Set<string>();
  const gone: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const target = targets[next];
      next += 1;
      if (!target) continue;
      const outcome = now() < deadline ? await send(target) : "failed";
      report[outcome] += 1;
      if (outcome === "sent") reminded.add(target.user_id);
      if (outcome === "gone") gone.push(target.endpoint);
    }
  };
  const lanes = Math.max(1, Math.min(options.concurrency ?? PUSH_CONCURRENCY, targets.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return { report, reminded: [...reminded].sort(), gone: gone.sort() };
}

async function rpc(deps: PushSendDeps, url: string, key: string, name: string, args: unknown): Promise<unknown> {
  const response = await deps.fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`push_rpc_${name}`);
  }
  const text = await response.text();
  return text === "" ? null : JSON.parse(text);
}

export async function handlePushSend(req: Request, deps: PushSendDeps): Promise<Response> {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const serviceKey = serviceRoleKey(deps.env);
  const caller = tagCallerKind({
    cronHeader: req.headers.get("x-flow-cron") ?? "",
    cronSecret: deps.env("CRON_SECRET"),
    authorization: req.headers.get("authorization") ?? "",
    serviceKey,
  });
  if (caller === null) return json({ error: "unauthorized" }, 401);
  await req.body?.cancel();
  const supabaseUrl = deps.env("SUPABASE_URL");
  if (supabaseUrl.trim() === "" || serviceKey.trim() === "") return json({ error: "missing_key" }, 500);
  const vapid = readVapid(deps.env);
  if (!vapid) return json({ error: "missing_vapid" }, 500);
  const now = deps.now ?? (() => new Date());
  try {
    const targets = parseTargets(await rpc(deps, supabaseUrl, serviceKey, "push_evening_targets", {}));
    const { report, reminded, gone } = await remindEvening(
      targets,
      (target) => sendPush(deps.fetch, target, eveningMessage(target.waiting), vapid, now()),
    );
    if (reminded.length > 0 || gone.length > 0) {
      await rpc(deps, supabaseUrl, serviceKey, "note_push_results", { p_reminded: reminded, p_gone: gone });
    }
    console.info(`push-send evening users=${report.users} sent=${report.sent} gone=${report.gone} failed=${report.failed}`);
    return json(report);
  } catch {
    return json({ error: "push_failed" }, 500);
  }
}
