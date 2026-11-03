import { assertEquals } from "jsr:@std/assert@1";
import { kickJev, syncAddedLines } from "./jev_kick.ts";

type Call = { url: string; init?: RequestInit };

function recorder(status = 200) {
  const calls: Call[] = [];
  const fetch = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response("{}", { status }));
  };
  return { calls, fetch };
}

Deno.test("only a sync that stored new lines asks Jev", () => {
  assertEquals(syncAddedLines({ ok: true, lines: 4, inserted: 2 }), true);
  assertEquals(syncAddedLines({ ok: true, lines: 4, inserted: 0, updated: 4 }), false);
  assertEquals(syncAddedLines({ ok: true, lines: 0, skipped: true }), false);
  assertEquals(syncAddedLines(null), false);
});

Deno.test("a manual sync asks jev-tag for its company, signed with the cron secret", async () => {
  const { calls, fetch } = recorder();
  const company = "00000000-0000-4000-8000-000000000001";
  assertEquals(await kickJev(fetch, "https://example.supabase.co/", "cron-secret", company), 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.url, "https://example.supabase.co/functions/v1/jev-tag");
  assertEquals(calls[0]?.init?.method, "POST");
  assertEquals(new Headers(calls[0]?.init?.headers).get("x-flow-cron"), "cron-secret");
  assertEquals(new Headers(calls[0]?.init?.headers).get("authorization"), null);
  assertEquals(JSON.parse(String(calls[0]?.init?.body)), { company_id: company });
});

Deno.test("the scheduled refreshes ask once for every company", async () => {
  const { calls, fetch } = recorder();
  await kickJev(fetch, "https://example.supabase.co", "cron-secret", null);
  assertEquals(JSON.parse(String(calls[0]?.init?.body)), {});
});

Deno.test("a busy or unreachable jev-tag never fails the sync", async () => {
  const busy = recorder(409);
  assertEquals(await kickJev(busy.fetch, "https://example.supabase.co", "cron-secret", null), 409);
  const down = () => Promise.reject(new Error("network"));
  assertEquals(await kickJev(down, "https://example.supabase.co", "cron-secret", null), null);
});

Deno.test("no URL or secret: no call", async () => {
  const { calls, fetch } = recorder();
  assertEquals(await kickJev(fetch, "", "cron-secret", null), null);
  assertEquals(await kickJev(fetch, "https://example.supabase.co", " ", null), null);
  assertEquals(calls.length, 0);
});
