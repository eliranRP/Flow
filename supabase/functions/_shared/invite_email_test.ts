import { machineProblems } from "../../../packages/shared/src/machine.ts";
import { handleInviteEmail, inviteBody, inviteSend, inviteSubject, resendRefused } from "./invite_email.ts";

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

type Claim = "ok" | "invite_email_limit" | "invite not found";

function fakeFetch(canManage: boolean, sent: unknown[], resendStatus = 200, claim: Claim = "ok", claims: unknown[] = []): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/rpc/claim_invite_email")) {
      claims.push(JSON.parse(String(init?.body)));
      if (claim === "ok") return Promise.resolve(Response.json({ id: INVITE, email_sends: 1 }));
      return Promise.resolve(Response.json({ code: claim === "invite_email_limit" ? "23514" : "P0001", message: claim }, { status: 400 }));
    }
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
  const claims: unknown[] = [];
  const res = await handleInviteEmail(request({ invite_id: INVITE }), { fetch: fakeFetch(true, sent, 200, "ok", claims), env });
  assertEquals(res.status, 200);
  assertEquals(claims, [{ p_invite_id: INVITE }]);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "noa@example.com");
  assertEquals(sent[0].subject, inviteSubject("Acme"));
});

Deno.test("an invite past its 3 emails is refused with email_limit and sends nothing", async () => {
  const sent: unknown[] = [];
  const res = await handleInviteEmail(request({ invite_id: INVITE }), {
    fetch: fakeFetch(true, sent, 200, "invite_email_limit"),
    env,
  });
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: "email_limit" });
  assertEquals(sent.length, 0);
});

Deno.test("an invite the claim no longer finds (expired, cancelled) sends nothing", async () => {
  const sent: unknown[] = [];
  const res = await handleInviteEmail(request({ invite_id: INVITE }), {
    fetch: fakeFetch(true, sent, 200, "invite not found"),
    env,
  });
  assertEquals(res.status, 404);
  assertEquals(sent.length, 0);
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

// FLOW-1168: a send Resend answered with an error gives its claim back; one that may have gone out does not.
function releaseRun(resend: number | "throw", claimed: unknown = { id: INVITE, email_sends: 2 }) {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const fake = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, auth: headers.get("authorization"), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.endsWith("/rpc/claim_invite_email")) return Promise.resolve(Response.json(claimed));
    if (url.endsWith("/rpc/release_invite_email")) return Promise.resolve(Response.json(true));
    if (url.endsWith("/rpc/list_team")) return Promise.resolve(Response.json(team(true)));
    if (url.endsWith("/rpc/list_my_companies")) return Promise.resolve(Response.json({ companies: [{ id: "c-1", name: "Acme" }] }));
    if (resend === "throw") return Promise.reject(new DOMException("timed out", "TimeoutError"));
    return Promise.resolve(new Response("{}", { status: resend }));
  }) as typeof fetch;
  const withKey = (name: string) => name === "SUPABASE_SECRET_KEYS" ? '{"default":"service-test"}' : env(name);
  return { calls, run: () => handleInviteEmail(request({ invite_id: INVITE }), { fetch: fake, env: withKey }) };
}

type Call = { url: string; auth: string | null; body: unknown };
const released = (calls: Call[]) => calls.filter((call) => call.url.endsWith("/rpc/release_invite_email"));

Deno.test("a send Resend refused gives its claim back, with the service key", async () => {
  const { calls, run } = releaseRun(422);
  const res = await run();
  assertEquals([res.status, await res.json()], [502, { error: "send_failed", status: 422 }]);
  assertEquals(released(calls).map((call) => [call.auth, call.body]), [["Bearer service-test", { p_invite_id: INVITE, p_send: 2 }]]);
});

Deno.test("a send that timed out keeps its claim: it may have gone out", async () => {
  const { calls, run } = releaseRun("throw");
  const res = await run();
  assertEquals([res.status, await res.json()], [502, { error: "send_failed" }]);
  assertEquals(released(calls).length, 0);
});

Deno.test("a sent email keeps its claim, and a claim with no number is never given back", async () => {
  const sent = releaseRun(200);
  assertEquals((await sent.run()).status, 200);
  assertEquals(released(sent.calls).length, 0);
  const old = releaseRun(422, { id: INVITE });
  assertEquals((await old.run()).status, 502);
  assertEquals(released(old.calls).length, 0);
});

// FLOW-1174: only an answer that says nothing went out gives the claim back. A 5xx or a gateway
// timeout may come after Resend took the mail; 408, 409 and 429 say "try later", and releasing on
// them would let a client loop on Resend's rate limit.
Deno.test("only a 4xx that says nothing went out gives the claim back", async () => {
  for (const status of [400, 401, 403, 404, 422]) {
    const { calls, run } = releaseRun(status);
    assertEquals([status, (await run()).status, released(calls).length], [status, 502, 1]);
  }
  for (const status of [408, 409, 429, 500, 502, 503, 504]) {
    const { calls, run } = releaseRun(status);
    const res = await run();
    assertEquals([status, res.status, await res.json(), released(calls).length], [status, 502, { error: "send_failed", status }, 0]);
  }
});

Deno.test("resendRefused: the statuses that certainly sent nothing", () => {
  assertEquals([400, 403, 422, 451].map(resendRefused), [true, true, true, true]);
  assertEquals([200, 202, 408, 409, 429, 500, 504, 302].map(resendRefused), [false, false, false, false, false, false, false, false]);
});

Deno.test("inviteSend: every state is reached and ends", () => {
  assertEquals(machineProblems(inviteSend), []);
});

Deno.test("inviteSend: a send's answer before its claim, or after it ended, changes nothing", () => {
  assertEquals(inviteSend.next("lookup", "answered"), "lookup");
  assertEquals(inviteSend.next(inviteSend.next("claimed", "lost"), "answered"), "spent");
  assertEquals(inviteSend.next("claimed", "failed"), "spent");
  assertEquals(inviteSend.next("refused", "claimed"), "refused");
});
