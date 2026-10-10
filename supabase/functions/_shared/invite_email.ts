// FLOW-601 follow-up: the invite-email function. The app calls it right after invite_member saved a new
// invite. It re-reads the team as the caller (list_team answers pending invites to the owner only), so a
// caller can only mail an invite of their own company, then sends one email through Resend.
// Nothing here changes the books or the invite. A failed send leaves the invite waiting in the invitee's inbox.

import { empty, json } from "./http.ts";

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

async function callerRpc(deps: InviteEmailDeps, req: Request, name: string): Promise<unknown> {
  const base = deps.env("SUPABASE_URL").replace(/\/+$/, "");
  const headers: Record<string, string> = {
    apikey: deps.env("SUPABASE_ANON_KEY"),
    authorization: req.headers.get("authorization") ?? "",
    "content-type": "application/json",
  };
  const company = req.headers.get("x-flow-company");
  if (company) headers["x-flow-company"] = company;
  const response = await deps.fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers, body: "{}" });
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
  const appUrl = deps.env("APP_URL").trim() || DEFAULT_APP_URL;
  const { html, text } = inviteBody(mail, appUrl);
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
    if (!response.ok) {
      await response.body?.cancel();
      return json({ error: "send_failed", status: response.status }, 502);
    }
    await response.body?.cancel();
  } catch {
    return json({ error: "send_failed" }, 502);
  }
  return json({ sent: true });
}
