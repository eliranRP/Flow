// FLOW-1168: a push claim no device took is given back; a test claim with no device is not spent;
// an endpoint that is not a push service's is never deleted as gone.
import { assertEquals } from "jsr:@std/assert@1";
import { machineProblems } from "../../../packages/shared/src/machine.ts";
import { PushClaims, pushClaim } from "./push_claim.ts";
import { handlePushSend } from "./push_send.ts";
import { base64UrlEncode } from "./webpush.ts";

const NOW = new Date("2026-11-13T15:00:00.000Z");
const FCM = "https://fcm.googleapis.com/fcm/send/example-device-1";
const APPLE = "https://web.push.apple.com/example-device-2";
const BAD = "https://example.com/not-a-push-service";
const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000b2";
const CLAIM = { mark: "2026-11-13T14:59:00+00:00", prev: "2026-11-13T14:00:00+00:00" };

async function keys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const device = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const p256dh = base64UrlEncode(new Uint8Array(await crypto.subtle.exportKey("raw", device.publicKey)));
  return {
    vapid: { publicKey: base64UrlEncode(raw), privateKey: jwk.d ?? "", subject: "mailto:push@example.com" },
    device: { p256dh, auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))) },
  };
}

/**
 * One push-send call. `rows` are what the claim (or the test targets) returns; `status` is each
 * endpoint's push service answer; `claim` is claim_push_test's answer for a test call.
 */
async function run(body: string, rows: Record<string, unknown>[], status: Record<string, number>, claim?: unknown) {
  const { vapid, device } = await keys();
  const rpcs: { name: string; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const name = request.url.match(/\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    if (name) {
      rpcs.push({ name, body: await request.json() });
      if (name === "claim_push_test") return Response.json(claim);
      if (name === "push_claim_targets" || name === "push_test_targets") {
        return Response.json(rows.map((row) => ({ ...row, ...device })));
      }
      return new Response(name === "push_release_claims" ? "1" : null, { status: name === "push_release_claims" ? 200 : 204 });
    }
    return new Response(null, { status: status[request.url] ?? 201 });
  };
  const warn = console.warn;
  const info = console.info;
  console.warn = () => {};
  console.info = () => {};
  try {
    const response = await handlePushSend(
      new Request("https://example.supabase.co/functions/v1/push-send", {
        method: "POST",
        headers: claim === undefined ? { "x-flow-cron": "cron-test" } : { authorization: "Bearer user-jwt" },
        body,
      }),
      {
        fetch,
        now: () => NOW,
        env: (name) => ({
          CRON_SECRET: "cron-test",
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_ANON_KEY: "anon-test",
          SUPABASE_SECRET_KEYS: '{"default":"service-test"}',
          VAPID_PUBLIC_KEY: vapid.publicKey,
          VAPID_PRIVATE_KEY: vapid.privateKey,
          VAPID_SUBJECT: vapid.subject,
        } as Record<string, string>)[name] ?? "",
      },
    );
    return { status: response.status, json: await response.json(), rpcs };
  } finally {
    console.warn = warn;
    console.info = info;
  }
}

const names = (rpcs: { name: string }[]) => rpcs.map((call) => call.name);

Deno.test("pushClaim: every state is reached and ends", () => {
  assertEquals(machineProblems(pushClaim), []);
});

Deno.test("pushClaim: a failure after a device took the push does not give it back", () => {
  // Out of order: one device answers sent, another's failure arrives after it.
  assertEquals(pushClaim.next(pushClaim.next("claimed", "sent"), "failed"), "delivered");
  assertEquals(pushClaim.next(pushClaim.next(pushClaim.next("claimed", "failed"), "sent"), "done"), "delivered");
  // An outcome after the claim ended changes nothing.
  assertEquals(pushClaim.next("released", "sent"), "released");
  assertEquals(pushClaim.next("spent", "failed"), "spent");
});

Deno.test("PushClaims: gives back only a user no device took, with a try that can pass", () => {
  const claims = new PushClaims(["a", "b", "c", "d"]);
  claims.note("a", "failed");
  claims.note("b", "failed");
  claims.note("b", "sent");
  claims.note("c", "refused");
  claims.note("c", "gone");
  claims.note("d", "failed");
  claims.note("d", "refused");
  assertEquals(claims.end(), { released: ["a", "d"], kept: ["b", "c"] });
});

Deno.test("a new-lines push the push service failed is given back for the next run", async () => {
  const result = await run('{"kind":"new"}', [{ user_id: U1, endpoint: FCM, fresh: 2, waiting: 0, claim: CLAIM }], { [FCM]: 503 });
  assertEquals(result.json, { users: 1, sent: 0, gone: 0, failed: 1 });
  assertEquals(result.rpcs.at(-1), {
    name: "push_release_claims",
    body: { p_kind: "new", p_claims: [{ user_id: U1, claim: CLAIM }] },
  });
});

Deno.test("a weekly push one device took is not given back, though another failed", async () => {
  const day = { day: "2026-11-15", prev: "2026-11-08" };
  const result = await run('{"kind":"weekly"}', [
    { user_id: U1, endpoint: FCM, fresh: 1, waiting: 0, claim: day },
    { user_id: U1, endpoint: APPLE, fresh: 1, waiting: 0, claim: day },
  ], { [FCM]: 503 });
  assertEquals(result.json, { users: 1, sent: 1, gone: 0, failed: 1 });
  assertEquals(names(result.rpcs), ["push_claim_targets"]);
});

Deno.test("a claim every device refused stays spent, and a malformed endpoint is not deleted as gone", async () => {
  const result = await run('{"kind":"new"}', [
    { user_id: U1, endpoint: BAD, fresh: 1, waiting: 0, claim: CLAIM },
    { user_id: U2, endpoint: APPLE, fresh: 1, waiting: 0, claim: CLAIM },
  ], { [APPLE]: 410 });
  assertEquals(result.json, { users: 2, sent: 0, gone: 1, failed: 1 });
  assertEquals(result.rpcs.slice(1), [{ name: "note_push_results", body: { p_reminded: [], p_gone: [APPLE] } }]);
});

Deno.test("a claim from before the migration (no claim field) is not given back", async () => {
  const result = await run('{"kind":"new"}', [{ user_id: U1, endpoint: FCM, fresh: 2, waiting: 0 }], { [FCM]: 503 });
  assertEquals(result.json, { users: 1, sent: 0, gone: 0, failed: 1 });
  assertEquals(names(result.rpcs), ["push_claim_targets"]);
});

Deno.test("a test push no device took gives its claim back", async () => {
  const claim = { user_id: U1, devices: 1, claim: 41 };
  const none = await run('{"kind":"test"}', [], {}, claim);
  assertEquals(none.json, { devices: 0, sent: 0, gone: 0, failed: 0 });
  assertEquals(none.rpcs.at(-1), { name: "release_push_test", body: { p_user: U1, p_claim: 41 } });

  const failed = await run('{"kind":"test"}', [{ user_id: U1, endpoint: FCM }], { [FCM]: 500 }, claim);
  assertEquals(failed.rpcs.at(-1), { name: "release_push_test", body: { p_user: U1, p_claim: 41 } });

  const sent = await run('{"kind":"test"}', [{ user_id: U1, endpoint: FCM }], {}, claim);
  assertEquals(sent.json, { devices: 1, sent: 1, gone: 0, failed: 0 });
  assertEquals(names(sent.rpcs), ["claim_push_test", "push_test_targets"]);

  // Before the migration the claim has no id: nothing to give back.
  const old = await run('{"kind":"test"}', [], {}, { user_id: U1, devices: 1 });
  assertEquals(names(old.rpcs), ["claim_push_test", "push_test_targets"]);
});
