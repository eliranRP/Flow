// FLOW-502: the push-send function. Three crons call it with a kind, each only when someone is due:
// flow-push-evening at 20:00 Israel time (owners with open review lines, once a day),
// flow-push-new every 5 minutes (new bank and SUMIT lines since the last push), and
// flow-push-weekly on Sunday at 08:00 (the week's new lines and what waits for review).
// Every count in a message comes from SQL (decision 0084), and no message names an amount.
// Nothing here changes the books.

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

/** A new-lines or weekly target, claimed by push_claim_targets. */
export interface CountTarget extends PushTarget {
  user_id: string;
  fresh: number;
  waiting: number;
}

export type PushKind = "evening" | "new" | "weekly";

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

/** The תנועה חדשה push: how many lines came in. Opens the review list when something waits. */
export function newLinesMessage(fresh: number, waiting: number): { title: string; body: string; url: string; tag: string } {
  return fresh === 1
    ? { title: "תנועה חדשה", body: "נכנסה תנועה חדשה", url: waiting > 0 ? "/review" : "/", tag: "new-lines" }
    : { title: "תנועות חדשות", body: `נכנסו ${fresh} תנועות חדשות`, url: waiting > 0 ? "/review" : "/", tag: "new-lines" };
}

/** The סיכום שבועי push: the week's new lines and what waits for review. */
export function weeklyMessage(fresh: number, waiting: number): { title: string; body: string; url: string; tag: string } {
  const lines = fresh === 0 ? "לא נכנסו תנועות השבוע" : fresh === 1 ? "תנועה אחת נכנסה השבוע" : `${fresh} תנועות נכנסו השבוע`;
  const review = waiting === 0 ? "הכול מאושר" : waiting === 1 ? "אחת מחכה לאישור" : `${waiting} מחכות לאישור`;
  return { title: "סיכום שבועי", body: `${lines} · ${review}`, url: waiting > 0 ? "/review" : "/", tag: "weekly-summary" };
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

function parseCountTargets(data: unknown): CountTarget[] {
  if (!Array.isArray(data)) throw new Error("push_targets");
  const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
  return data.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (
      typeof item.user_id !== "string" || typeof item.endpoint !== "string" ||
      typeof item.p256dh !== "string" || typeof item.auth !== "string" ||
      !count(item.fresh) || !count(item.waiting) || item.fresh + item.waiting === 0
    ) return [];
    return [{
      user_id: item.user_id,
      endpoint: item.endpoint,
      p256dh: item.p256dh,
      auth: item.auth,
      fresh: item.fresh,
      waiting: item.waiting,
    }];
  });
}

/** The kind in the cron's body. No body or no kind is the evening reminder, as before. */
async function readKind(req: Request): Promise<PushKind | null> {
  const text = await req.text().catch(() => "");
  if (text.trim() === "") return "evening";
  try {
    const body = JSON.parse(text) as unknown;
    const kind = body && typeof body === "object" ? (body as Record<string, unknown>).kind : undefined;
    if (kind === undefined) return "evening";
    return kind === "evening" || kind === "new" || kind === "weekly" ? kind : null;
  } catch {
    return null;
  }
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
export async function remindEvening<T extends PushTarget & { user_id: string }>(
  targets: readonly T[],
  send: (target: T) => Promise<PushOutcome>,
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
  const kind = await readKind(req);
  if (kind === null) return json({ error: "kind" }, 400);
  const supabaseUrl = deps.env("SUPABASE_URL");
  if (supabaseUrl.trim() === "" || serviceKey.trim() === "") return json({ error: "missing_key" }, 500);
  const vapid = readVapid(deps.env);
  if (!vapid) return json({ error: "missing_vapid" }, 500);
  const now = deps.now ?? (() => new Date());
  try {
    let result: { report: PushReport; reminded: string[]; gone: string[] };
    if (kind === "evening") {
      const targets = parseTargets(await rpc(deps, supabaseUrl, serviceKey, "push_evening_targets", {}));
      result = await remindEvening(
        targets,
        (target) => sendPush(deps.fetch, target, eveningMessage(target.waiting), vapid, now()),
      );
    } else {
      // The claim moves each user's mark first, so a failed push is not sent again.
      const targets = parseCountTargets(await rpc(deps, supabaseUrl, serviceKey, "push_claim_targets", { p_kind: kind }));
      const message = kind === "new" ? newLinesMessage : weeklyMessage;
      result = await remindEvening(
        targets,
        (target) => sendPush(deps.fetch, target, message(target.fresh, target.waiting), vapid, now()),
      );
      result.reminded = [];
    }
    const { report, reminded, gone } = result;
    if (reminded.length > 0 || gone.length > 0) {
      await rpc(deps, supabaseUrl, serviceKey, "note_push_results", { p_reminded: reminded, p_gone: gone });
    }
    console.info(`push-send ${kind} users=${report.users} sent=${report.sent} gone=${report.gone} failed=${report.failed}`);
    return json(report);
  } catch {
    return json({ error: "push_failed" }, 500);
  }
}
