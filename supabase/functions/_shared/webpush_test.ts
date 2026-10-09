// FLOW-502: Web Push encryption, VAPID signing and the push-send function, with keys made here.
import { base64UrlDecode, base64UrlEncode, encryptPush, sendPush, vapidAuthorization, type VapidKeys } from "./webpush.ts";
import { eveningMessage, handlePushSend, readVapid, remindEvening, type EveningTarget } from "./push_send.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const NOW = new Date("2026-10-09T17:00:00.000Z");
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/example-device-1";
const encoder = new TextEncoder();

async function vapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey: base64UrlEncode(raw), privateKey: jwk.d ?? "", subject: "mailto:push@example.com" };
}

async function browser() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, raw, auth, p256dh: base64UrlEncode(raw), authText: base64UrlEncode(auth) };
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** The browser's side of RFC 8291, written out here so the test does not trust the sender. */
async function decrypt(record: Uint8Array<ArrayBuffer>, receiver: Awaited<ReturnType<typeof browser>>): Promise<string> {
  const salt = record.slice(0, 16);
  assertEquals(Array.from(record.slice(16, 20)), [0, 0, 16, 0]);
  const idLength = record[20] ?? 0;
  const senderRaw = record.slice(21, 21 + idLength);
  const sealed = record.slice(21 + idLength);
  const sender = await crypto.subtle.importKey("raw", senderRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: sender }, receiver.pair.privateKey, 256));
  const info = new Uint8Array([...encoder.encode("WebPush: info\0"), ...receiver.raw, ...senderRaw]);
  const ikm = await hkdf(receiver.auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, sealed));
  assertEquals(padded[padded.length - 1], 2);
  return new TextDecoder().decode(padded.slice(0, -1));
}

Deno.test("the browser decrypts what encryptPush seals", async () => {
  const receiver = await browser();
  const record = await encryptPush(encoder.encode('{"title":"תזכורת ערב"}'), { p256dh: receiver.p256dh, auth: receiver.authText });
  assertEquals(record[20], 65);
  assertEquals(await decrypt(record, receiver), '{"title":"תזכורת ערב"}');
});

Deno.test("encryptPush refuses bad keys and an oversized payload", async () => {
  const receiver = await browser();
  for (const target of [
    { p256dh: receiver.p256dh.slice(0, 40), auth: receiver.authText },
    { p256dh: receiver.p256dh, auth: base64UrlEncode(new Uint8Array(8)) },
  ]) {
    let failed = false;
    try {
      await encryptPush(encoder.encode("x"), target);
    } catch {
      failed = true;
    }
    assertEquals(failed, true);
  }
  let tooLong = false;
  try {
    await encryptPush(new Uint8Array(4000), { p256dh: receiver.p256dh, auth: receiver.authText });
  } catch {
    tooLong = true;
  }
  assertEquals(tooLong, true);
});

Deno.test("the VAPID header carries a valid ES256 token for the push service's origin", async () => {
  const keys = await vapidKeys();
  const header = await vapidAuthorization(ENDPOINT, keys, NOW);
  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  if (!match) throw new Error(header);
  const [, head, body, signature, k] = match;
  assertEquals(k, keys.publicKey);
  assertEquals(JSON.parse(new TextDecoder().decode(base64UrlDecode(head ?? ""))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(body ?? "")));
  assertEquals(claims, { aud: "https://fcm.googleapis.com", exp: NOW.getTime() / 1000 + 43200, sub: "mailto:push@example.com" });
  const publicKey = await crypto.subtle.importKey("raw", base64UrlDecode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    base64UrlDecode(signature ?? ""),
    encoder.encode(`${head}.${body}`),
  );
  assertEquals(ok, true);
});

Deno.test("sendPush posts an encrypted body and reads the push service's answer", async () => {
  const keys = await vapidKeys();
  const receiver = await browser();
  const target = { endpoint: ENDPOINT, p256dh: receiver.p256dh, auth: receiver.authText };
  const seen: Request[] = [];
  const answer = (status: number): typeof fetch => (input, init) => {
    seen.push(new Request(input, init));
    return Promise.resolve(new Response(null, { status }));
  };
  assertEquals(await sendPush(answer(201), target, { body: "שלום" }, keys, NOW), "sent");
  const request = seen[0];
  if (!request) throw new Error("no request");
  assertEquals(request.url, ENDPOINT);
  assertEquals(request.headers.get("content-encoding"), "aes128gcm");
  assertEquals(request.headers.get("ttl"), "14400");
  assertEquals((request.headers.get("authorization") ?? "").startsWith("vapid t="), true);
  assertEquals(await decrypt(new Uint8Array(await request.arrayBuffer()), receiver), '{"body":"שלום"}');
  assertEquals(await sendPush(answer(410), target, {}, keys, NOW), "gone");
  assertEquals(await sendPush(answer(404), target, {}, keys, NOW), "gone");
  assertEquals(await sendPush(answer(500), target, {}, keys, NOW), "failed");
  const thrown: typeof fetch = () => Promise.reject(new Error("offline"));
  assertEquals(await sendPush(thrown, target, {}, keys, NOW), "failed");
});

Deno.test("sendPush never posts to a host that is not a push service", async () => {
  const keys = await vapidKeys();
  const receiver = await browser();
  let calls = 0;
  const count: typeof fetch = () => {
    calls += 1;
    return Promise.resolve(new Response(null, { status: 201 }));
  };
  for (const endpoint of [
    "https://example.com/push/1",
    "http://fcm.googleapis.com/fcm/send/1",
    "https://fcm.googleapis.com.example.com/x",
    "https://169.254.169.254/latest",
  ]) {
    assertEquals(await sendPush(count, { endpoint, p256dh: receiver.p256dh, auth: receiver.authText }, {}, keys, NOW), "gone");
  }
  assertEquals(calls, 0);
});

Deno.test("the evening line names the waiting count", () => {
  assertEquals(eveningMessage(1).body, "תנועה אחת מחכה לאישור");
  assertEquals(eveningMessage(7), { title: "תזכורת ערב", body: "7 תנועות מחכות לאישור", url: "/review", tag: "evening-reminder" });
});

Deno.test("a user is reminded when one device took it; gone devices are listed", async () => {
  const target = (user: string, endpoint: string): EveningTarget => ({ user_id: user, endpoint, p256dh: "p", auth: "a", waiting: 2 });
  const outcomes: Record<string, "sent" | "gone" | "failed"> = { e1: "gone", e2: "sent", e3: "failed" };
  const result = await remindEvening(
    [target("u1", "e1"), target("u1", "e2"), target("u2", "e3")],
    (item) => Promise.resolve(outcomes[item.endpoint] ?? "failed"),
  );
  assertEquals(result.report, { users: 2, sent: 1, gone: 1, failed: 1 });
  assertEquals(result.reminded, ["u1"]);
  assertEquals(result.gone, ["e1"]);
});

function env(values: Record<string, string>): (name: string) => string {
  return (name) => values[name] ?? "";
}

Deno.test("push-send refuses a caller without the cron secret or the service key", async () => {
  const response = await handlePushSend(
    new Request("https://example.supabase.co/functions/v1/push-send", { method: "POST", headers: { authorization: "Bearer user-jwt" } }),
    { fetch, env: env({ CRON_SECRET: "cron-test", SUPABASE_SECRET_KEYS: '{"default":"service-test"}' }) },
  );
  assertEquals(response.status, 401);
  assertEquals(readVapid(env({ VAPID_PUBLIC_KEY: "k", VAPID_PRIVATE_KEY: "d", VAPID_SUBJECT: "push@example.com" })), null);
});

Deno.test("push-send reminds due users and records the results", async () => {
  const keys = await vapidKeys();
  const receiver = await browser();
  const calls: { url: string; body: unknown }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/rest/v1/rpc/push_evening_targets")) {
      assertEquals(request.headers.get("authorization"), "Bearer service-test");
      return new Response(JSON.stringify([
        { user_id: "u1", endpoint: ENDPOINT, p256dh: receiver.p256dh, auth: receiver.authText, waiting: 3 },
        { user_id: "u2", endpoint: "https://web.push.apple.com/example-device-2", p256dh: receiver.p256dh, auth: receiver.authText, waiting: 1 },
        { user_id: "u3", endpoint: ENDPOINT, p256dh: receiver.p256dh, auth: receiver.authText, waiting: 0 },
      ]), { status: 200 });
    }
    if (request.url.endsWith("/rest/v1/rpc/note_push_results")) {
      calls.push({ url: "note", body: await request.json() });
      return new Response(null, { status: 204 });
    }
    calls.push({ url: request.url, body: null });
    return new Response(null, { status: request.url.includes("apple") ? 410 : 201 });
  };
  const response = await handlePushSend(
    new Request("https://example.supabase.co/functions/v1/push-send", { method: "POST", headers: { "x-flow-cron": "cron-test" }, body: "{}" }),
    {
      fetch: fakeFetch,
      now: () => NOW,
      env: env({
        CRON_SECRET: "cron-test",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SECRET_KEYS: '{"default":"service-test"}',
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: keys.subject,
      }),
    },
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { users: 2, sent: 1, gone: 1, failed: 0 });
  assertEquals(calls.map((call) => call.url).sort(), [ENDPOINT, "https://web.push.apple.com/example-device-2", "note"].sort());
  assertEquals(calls[calls.length - 1]?.url, "note");
  assertEquals(calls[calls.length - 1]?.body, { p_reminded: ["u1"], p_gone: ["https://web.push.apple.com/example-device-2"] });
});

Deno.test("encryptPush matches the RFC 8291 appendix A example", async () => {
  const senderPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
  const raw = base64UrlDecode(senderPublic);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(raw.slice(1, 33)),
    y: base64UrlEncode(raw.slice(33)),
    d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
    ext: true,
  };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = await crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const record = await encryptPush(
    encoder.encode("When I grow up, I want to be a watermelon"),
    {
      p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
    },
    { ephemeral: { privateKey, publicKey }, salt: base64UrlDecode("DGv6ra1nlYgDCS1FRnbzlw") },
  );
  assertEquals(
    base64UrlEncode(record),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  );
});

Deno.test("a push service that hangs times out as failed", async () => {
  const keys = await vapidKeys();
  const receiver = await browser();
  const hang: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const target = { endpoint: ENDPOINT, p256dh: receiver.p256dh, auth: receiver.authText };
  assertEquals(await sendPush(hang, target, {}, keys, NOW, 60, 20), "failed");
});

Deno.test("no send starts after the budget, and sends run side by side", async () => {
  const target = (user: string, endpoint: string): EveningTarget => ({ user_id: user, endpoint, p256dh: "p", auth: "a", waiting: 1 });
  let clock = 0;
  let running = 0;
  let peak = 0;
  const started: string[] = [];
  const result = await remindEvening(
    Array.from({ length: 12 }, (_, index) => target(`u${index}`, `e${index}`)),
    async (item) => {
      started.push(item.endpoint);
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      clock += 10;
      running -= 1;
      return "sent";
    },
    { now: () => clock, budgetMs: 25, concurrency: 3 },
  );
  assertEquals(peak, 3);
  assertEquals(started.length < 12, true);
  assertEquals(result.report.sent + result.report.failed, 12);
  assertEquals(result.report.sent, started.length);
});
