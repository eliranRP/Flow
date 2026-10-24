// FLOW-516: push-send's "test" kind (the caller's own devices, the user's JWT, the hourly limit)
// and the failure log line.
import { base64UrlEncode, failureLine, sendPush, type VapidKeys } from "./webpush.ts";
import { handlePushSend, testMessage } from "./push_send.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const NOW = new Date("2026-10-20T17:00:00.000Z");
const USER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const OWN = "https://web.push.apple.com/example-own-device";
const FOREIGN = "https://fcm.googleapis.com/fcm/send/example-other-device";

async function vapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: base64UrlEncode(raw), privateKey: jwk.d ?? "", subject: "mailto:push@example.com" };
}

async function browserKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { p256dh: base64UrlEncode(raw), auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))) };
}

type Seen = { url: string; authorization: string | null; apikey: string | null; body: unknown };

/** Runs one push-send call with a fake database and push service. */
async function run(
  headers: Record<string, string>,
  claim: { status: number; body: unknown },
  body = '{"kind":"test"}',
) {
  const keys = await vapidKeys();
  const device = await browserKeys();
  const seen: Seen[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    seen.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      apikey: request.headers.get("apikey"),
      body: request.url.includes("/rest/v1/") && text !== "" ? JSON.parse(text) : null,
    });
    if (request.url.endsWith("/rpc/claim_push_test")) return new Response(JSON.stringify(claim.body), { status: claim.status });
    if (request.url.endsWith("/rpc/push_test_targets")) {
      // A read that wrongly returned another user's device: push-send still skips it.
      return new Response(JSON.stringify([
        { user_id: USER, endpoint: OWN, ...device },
        { user_id: OTHER, endpoint: FOREIGN, ...device },
      ]), { status: 200 });
    }
    if (request.url.endsWith("/rpc/note_push_results")) return new Response(null, { status: 204 });
    return new Response(null, { status: 201 });
  };
  const response = await handlePushSend(
    new Request("https://example.supabase.co/functions/v1/push-send", { method: "POST", headers, body }),
    {
      fetch: fakeFetch,
      now: () => NOW,
      env: (name) => ({
        CRON_SECRET: "cron-test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon-test",
        SUPABASE_SECRET_KEYS: '{"default":"service-test"}',
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: keys.subject,
      } as Record<string, string>)[name] ?? "",
    },
  );
  return { status: response.status, json: await response.json(), seen };
}

const CLAIMED = { status: 200, body: { user_id: USER, devices: 1 } };

Deno.test("a test push needs the user's own JWT: none, the service key or the cron secret is refused", async () => {
  const callers: Record<string, string>[] = [{}, { authorization: "Bearer service-test" }, { "x-flow-cron": "cron-test" }, { authorization: "Bearer user-jwt", "x-flow-cron": "cron-test" }];
  for (const headers of callers) {
    const result = await run(headers, CLAIMED);
    assertEquals([result.status, result.json, result.seen.length], [401, { error: "unauthorized" }, 0]);
  }
});

Deno.test("a JWT the database refuses sends nothing", async () => {
  const result = await run({ authorization: "Bearer expired-jwt" }, { status: 401, body: { message: "JWT expired" } });
  assertEquals([result.status, result.json], [401, { error: "unauthorized" }]);
  assertEquals(result.seen.map((call) => call.url), ["https://example.supabase.co/rest/v1/rpc/claim_push_test"]);
});

Deno.test("past the hourly limit the test push is refused with 429 and nothing is sent", async () => {
  const result = await run({ authorization: "Bearer user-jwt" }, { status: 400, body: { code: "23514", message: "push_test_limit" } });
  assertEquals([result.status, result.json], [429, { error: "push_test_limit" }]);
  assertEquals(result.seen.length, 1);
});

Deno.test("the test push goes only to the caller's own devices, named by the database from the JWT", async () => {
  const result = await run({ authorization: "Bearer user-jwt" }, CLAIMED);
  assertEquals([result.status, result.json], [200, { devices: 1, sent: 1, gone: 0, failed: 0 }]);
  const [claim, targets, push, ...rest] = result.seen;
  // The claim runs as the user (their JWT, the anon key), never with the service key.
  assertEquals([claim?.authorization, claim?.apikey], ["Bearer user-jwt", "anon-test"]);
  // The devices are read with the service key, for the user the claim returned.
  assertEquals([targets?.url.endsWith("/rpc/push_test_targets"), targets?.authorization, targets?.body], [true, "Bearer service-test", { p_user: USER }]);
  assertEquals([push?.url, rest.length], [OWN, 0]);
});

Deno.test("a user with no saved device gets a zero report and no device read", async () => {
  const result = await run({ authorization: "Bearer user-jwt" }, { status: 200, body: { user_id: USER, devices: 0 } });
  assertEquals([result.status, result.json, result.seen.length], [200, { devices: 0, sent: 0, gone: 0, failed: 0 }, 1]);
});

Deno.test("the test message opens Settings → התראות", () => {
  assertEquals(testMessage(), { title: "התראת בדיקה", body: "כך ייראו ההתראות מ־Flow", url: "/settings/notifications", tag: "test-push" });
});

Deno.test("a failed send logs the host, the status and a short answer, never the device path", async () => {
  assertEquals(
    failureLine("https://web.push.apple.com/secret-device-path", 403, '{"reason":"BadJwtToken"}\n'),
    'push failed host=web.push.apple.com status=403 body={"reason":"BadJwtToken"}',
  );
  assertEquals(failureLine("not a url", "TimeoutError"), "push failed host=unknown status=TimeoutError");
  const long = failureLine(OWN, 500, `see https://example.com/x ${"a".repeat(300)}`);
  assertEquals([long.split(" body=")[1].startsWith("see <url> aaa"), long.length < 200], [true, true]);

  const keys = await vapidKeys();
  const device = await browserKeys();
  const lines: string[] = [];
  const warn = console.warn;
  console.warn = (line: string) => { lines.push(line); };
  try {
    const answer: typeof fetch = () => Promise.resolve(new Response('{"reason":"BadJwtToken"}', { status: 403 }));
    assertEquals(await sendPush(answer, { endpoint: OWN, ...device }, {}, keys, NOW), "failed");
  } finally {
    console.warn = warn;
  }
  assertEquals(lines, ['push failed host=web.push.apple.com status=403 body={"reason":"BadJwtToken"}']);
});
