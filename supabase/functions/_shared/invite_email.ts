// FLOW-601 follow-up: the invite-email function. The app calls it right after invite_member saved a new
// invite. It re-reads the team as the caller (list_team answers pending invites to the owner only), so a
// caller can only mail an invite of their own company, then sends one email through Resend.
// Before sending it claims the send with claim_invite_email (decision 0195): at most 3 emails per
// pending, unexpired invite, so a caller cannot mail one address without bound. Nothing here changes
// the books. A failed send leaves the invite waiting in the invitee's inbox.
// FLOW-1168: a send Resend answered with an error sent nothing, so its claim is given back
// (release_invite_email, with the service key). A send that timed out or lost its connection may
// have gone out, so it keeps its claim: an invite never gets more than 3 real emails.

import { defineMachine } from "../../../packages/shared/src/machine.ts";
import { empty, json } from "./http.ts";
import { serviceRoleKey } from "./jev_tag.ts";

/** One call's send. `answered` is Resend's error answer: nothing went out. */
export const inviteSend = defineMachine({
  name: "inviteSend",
  initial: "lookup",
  final: ["refused", "sent", "released", "spent"],
  states: {
    lookup: { claimed: "claimed", refused: "refused" },
    claimed: { sent: "sent", answered: "released", lost: "spent" },
    refused: {},
    sent: {},
    released: {},
    spent: {},
  },
});

export interface InviteEmailDeps {
  fetch: typeof fetch;
  env: (name: string) => string;
}

export interface InviteMail {
  email: string;
  role: "editor" | "viewer";
  inviter: string;
  company: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESEND_TIMEOUT_MS = 15_000;
const DEFAULT_FROM = "Flow <onboarding@resend.dev>";
const DEFAULT_APP_URL = "https://flow-app-dx5.pages.dev";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function inviteSubject(company: string): string {
  return `הוזמנת להצטרף ל-${company} ב-Flow`;
}

/** The email, Hebrew and short. The invitee signs in with Google using this address and finds the invite. */
export function inviteBody(mail: InviteMail, appUrl: string): { html: string; text: string } {
  const role = mail.role === "editor" ? "עורך" : "צפייה בלבד";
  const lines = [
    `${mail.inviter} הזמינו אותך להצטרף ל-${mail.company} ב-Flow.`,
    `התפקיד: ${role}.`,
    `כדי להצטרף, היכנסו עם Google באמצעות הכתובת ${mail.email}. ההזמנה מחכה לכם שם.`,
  ];
  const html = `<div dir="rtl" style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.6">${
    lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
  }<p><a href="${escapeHtml(appUrl)}">פתיחת Flow</a></p></div>`;
  return { html, text: `${lines.join("\n")}\n${appUrl}` };
}

async function readInviteId(req: Request): Promise<string | null> {
  try {
    const body = (await req.json()) as { invite_id?: unknown };
    return typeof body.invite_id === "string" && UUID.test(body.invite_id) ? body.invite_id.toLowerCase() : null;
  } catch {
    return null;
  }
}

async function callerFetch(deps: InviteEmailDeps, req: Request, name: string, body: unknown): Promise<Response> {
  const base = deps.env("SUPABASE_URL").replace(/\/+$/, "");
  const headers: Record<string, string> = {
    apikey: deps.env("SUPABASE_ANON_KEY"),
    authorization: req.headers.get("authorization") ?? "",
    "content-type": "application/json",
  };
  const company = req.headers.get("x-flow-company");
  if (company) headers["x-flow-company"] = company;
  return await deps.fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function callerRpc(deps: InviteEmailDeps, req: Request, name: string): Promise<unknown> {
  const response = await callerFetch(deps, req, name, {});
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`invite_rpc_${name}`);
  }
  return await response.json();
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The pending invite, its company's name and the inviter's name, as the caller (an owner) sees them. */
export async function loadInviteMail(deps: InviteEmailDeps, req: Request, inviteId: string): Promise<InviteMail | null> {
  const team = record(await callerRpc(deps, req, "list_team"));
  if (!team || team.can_manage !== true || !Array.isArray(team.invites)) return null;
  const invite = team.invites.map(record).find((row) => row?.id === inviteId);
  if (!invite || typeof invite.email !== "string") return null;
  const members = Array.isArray(team.members) ? team.members.map(record) : [];
  const me = members.find((member) => member?.you === true);
  const companies = record(await callerRpc(deps, req, "list_my_companies"));
  const list = Array.isArray(companies?.companies) ? companies.companies.map(record) : [];
  const current = list.find((company) => company?.id === team.company_id);
  return {
    email: invite.email,
    role: invite.role === "editor" ? "editor" : "viewer",
    inviter: typeof me?.name === "string" && me.name.trim() !== "" ? me.name.trim() : "בעל החברה",
    company: typeof current?.name === "string" && current.name.trim() !== "" ? current.name.trim() : "החברה",
  };
}

/**
 * Claims one send of the invite: its number (1 to 3; null when the answer does not say), "limit"
 * past 3 emails of this invite, or "gone".
 */
export async function claimInviteEmail(
  deps: InviteEmailDeps,
  req: Request,
  inviteId: string,
): Promise<{ send: number | null } | "limit" | "gone"> {
  const response = await callerFetch(deps, req, "claim_invite_email", { p_invite_id: inviteId });
  if (response.ok) {
    const sends = record(await response.json().catch(() => null))?.email_sends;
    return { send: typeof sends === "number" && Number.isInteger(sends) && sends >= 1 && sends <= 3 ? sends : null };
  }
  const error = record(await response.json().catch(() => null));
  if (error?.message === "invite_email_limit") return "limit";
  if (error?.message === "invite not found") return "gone";
  throw new Error("invite_rpc_claim_invite_email");
}

export async function handleInviteEmail(req: Request, deps: InviteEmailDeps): Promise<Response> {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if ((req.headers.get("authorization") ?? "").trim() === "") return json({ error: "unauthorized" }, 401);
  const inviteId = await readInviteId(req);
  if (inviteId === null) return json({ error: "invite_id" }, 400);
  const apiKey = deps.env("RESEND_API_KEY").trim();
  if (apiKey === "" || deps.env("SUPABASE_URL").trim() === "" || deps.env("SUPABASE_ANON_KEY").trim() === "") {
    return json({ error: "missing_key" }, 500);
  }
  let mail: InviteMail | null;
  try {
    mail = await loadInviteMail(deps, req, inviteId);
  } catch {
    return json({ error: "lookup_failed" }, 502);
  }
  if (!mail) return json({ error: "not_found" }, 404);
  let send: number | null;
  try {
    const claim = await claimInviteEmail(deps, req, inviteId);
    if (claim === "limit") return json({ error: "email_limit" }, 429);
    if (claim === "gone") return json({ error: "not_found" }, 404);
    send = claim.send;
  } catch {
    return json({ error: "lookup_failed" }, 502);
  }
  let step = inviteSend.next(inviteSend.initial, "claimed");
  const appUrl = deps.env("APP_URL").trim() || DEFAULT_APP_URL;
  const { html, text } = inviteBody(mail, appUrl);
  let status: number | null = null;
  try {
    const response = await deps.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `invite-${inviteId}`,
      },
      body: JSON.stringify({
        from: deps.env("INVITE_EMAIL_FROM").trim() || DEFAULT_FROM,
        to: mail.email,
        subject: inviteSubject(mail.company),
        html,
        text,
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    await response.body?.cancel();
    status = response.status;
    step = inviteSend.next(step, response.ok ? "sent" : "answered");
  } catch {
    step = inviteSend.next(step, "lost");
  }
  if (step === "sent") return json({ sent: true });
  if (step === "released") await releaseClaim(deps, inviteId, send);
  return json(status === null ? { error: "send_failed" } : { error: "send_failed", status }, 502);
}

/**
 * Gives back the claim of a send Resend refused. Never throws: without the service key, before the
 * migration, or when it fails, the claim stays spent, as before.
 */
async function releaseClaim(deps: InviteEmailDeps, inviteId: string, send: number | null): Promise<void> {
  const key = serviceRoleKey(deps.env);
  if (send === null || key.trim() === "") return;
  try {
    const response = await deps.fetch(`${deps.env("SUPABASE_URL").replace(/\/+$/, "")}/rest/v1/rpc/release_invite_email`, {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ p_invite_id: inviteId, p_send: send }),
    });
    await response.body?.cancel();
    if (!response.ok) console.error(`invite-email release status=${String(response.status)}`);
  } catch {
    console.error("invite-email release error");
  }
}
