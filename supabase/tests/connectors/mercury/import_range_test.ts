// FLOW-505: a Mercury run that stops at the page cap keeps the import start, like a complete run.
import { assertEquals } from "jsr:@std/assert@1";
import { fetchMercurySince, openMercury } from "../../../functions/_shared/connectors/mercury/client.ts";

const NOW = new Date("2026-10-04T08:00:00.000Z");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

// Pending pages never end, so the run stops at the page cap and returns a resume cursor.
const fetchImpl: typeof fetch = (input) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname.endsWith("/transactions") && url.searchParams.get("status") === "pending") {
    const page = Number(url.searchParams.get("start_after")?.slice(2) ?? "0");
    const old = page % 2 === 0;
    return Promise.resolve(jsonResponse({
      transactions: [{
        id: `p-${page}`,
        status: old && page % 4 === 0 ? "failed" : "pending",
        createdAt: old ? "2026-01-10T10:00:00.000Z" : "2026-09-10T10:00:00.000Z",
      }],
      page: { nextPage: `n-${page + 1}` },
    }));
  }
  return Promise.resolve(jsonResponse({ transactions: [], accounts: [], page: {} }));
};

Deno.test("a page-capped run drops lines before the import start", async () => {
  const session = openMercury("secret", { fetch: fetchImpl, now: () => NOW });
  const result = await fetchMercurySince(session, { cursor: null, importFrom: "2026-03-01", lookbackDays: 30 });
  assertEquals(result.complete, false);
  const ids = result.lines.map((row) => (row as { id: string }).id);
  assertEquals(ids.length, 10);
  assertEquals(ids.every((id) => Number(id.slice(2)) % 2 === 1), true);
  assertEquals(result.removedIds, []);
});

Deno.test("with no import start a page-capped run keeps every line", async () => {
  const session = openMercury("secret", { fetch: fetchImpl, now: () => NOW });
  const result = await fetchMercurySince(session, { cursor: null, importFrom: null, lookbackDays: 30 });
  assertEquals(result.complete, false);
  assertEquals(result.lines.length, 20);
  assertEquals(result.removedIds.length, 5);
});
