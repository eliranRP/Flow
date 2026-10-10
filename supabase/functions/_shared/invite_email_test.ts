import { handleInviteEmail, inviteBody, inviteSubject } from "./invite_email.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const INVITE = "6f1b2c3d-1111-4222-8333-444455556666";
const env = (name: string) => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  RESEND_API_KEY: "re_example",
} as Record<string, string>)[name] ?? "";

const team = (canManage: boolean) => ({
  company_id: "c-1",
  can_manage: canManage,
  members: [{ name: "Dana", you: true }],
  invites: canManage ? [{ id: INVITE, email: "noa@example.com", role: "editor" }] : [],
});

function request(body: unknown, authorization = "Bearer user"): Request {
  return new Request("https://example.com/invite-email", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fakeFetch(canManage: boolean, sent: unknown[], resendStatus = 200): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/rpc/list_team")) return Promise.resolve(Response.json(team(canManage)));
    if (url.endsWith("/rpc/list_my_companies")) {
      return Promise.resolve(Response.json({ companies: [{ id: "c-1", name: "Acme" }] }));
    }
    sent.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response("{}", { status: resendStatus }));
  }) as typeof fetch;
}

Deno.test("the owner's invite is mailed once, to the invited address", async () => {
  const sent: Array<Record<string, unknown>> = [];
  const res = await handleInviteEmail(request({ invite_id: INVITE }), { fetch: fakeFetch(true, sent), env });
  assertEquals(res.status, 200);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "noa@example.com");
  assertEquals(sent[0].subject, inviteSubject("Acme"));
});

Deno.test("a caller who cannot manage the team sends nothing", async () => {
  const sent: unknown[] = [];
  const res = await handleInviteEmail(request({ invite_id: INVITE }), { fetch: fakeFetch(false, sent), env });
  assertEquals(res.status, 404);
  assertEquals(sent.length, 0);
});

Deno.test("no token or a bad invite id is refused before any lookup", async () => {
  const sent: unknown[] = [];
  const deps = { fetch: fakeFetch(true, sent), env };
  assertEquals((await handleInviteEmail(request({ invite_id: INVITE }, ""), deps)).status, 401);
  assertEquals((await handleInviteEmail(request({ invite_id: "nope" }), deps)).status, 400);
  assertEquals(sent.length, 0);
});

Deno.test("a provider refusal is reported, not hidden", async () => {
  const res = await handleInviteEmail(request({ invite_id: INVITE }), { fetch: fakeFetch(true, [], 403), env });
  assertEquals(res.status, 502);
});

Deno.test("the body escapes the names it shows", () => {
  const { html } = inviteBody({ email: "a@example.com", role: "viewer", inviter: "<b>x</b>", company: "A&B" }, "https://example.com");
  assertEquals(html.includes("<b>x</b>"), false);
  assertEquals(html.includes("A&amp;B"), true);
});
