// FLOW-509: the path wildcards, the bounded treasury ledger read, and treasury void matching.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { assertMercuryGet } from "../../../functions/_shared/connectors/mercury/guard.ts";
import { fetchMercurySince, mercuryTreasuryAccountCount, openMercury } from "../../../functions/_shared/connectors/mercury/client.ts";
import { treasuryVoidIds, type TreasuryStoredLine } from "../../../functions/_shared/connectors/mercury/normalize.ts";

const NOW = new Date("2026-10-04T08:00:00.000Z");
const TREASURY_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TREASURY_B = "bbbbbbbb-0000-4000-8000-00000000000b";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

Deno.test("the path wildcards take one plain id segment only", () => {
  assertMercuryGet("GET", "/transaction/txn_1");
  assertMercuryGet("GET", "/transaction/11111111-1111-4111-8111-111111111111");
  assertMercuryGet("GET", `/treasury/${TREASURY_A}/transactions`);
  for (const path of [
    "/transaction/{transactionId}",
    "/treasury/{treasuryId}/transactions",
    "/transaction/%2e%2e",
    "/transaction/a%2Fb",
    "/transaction/a/b",
    "/transaction/",
    "/transaction/a#b",
    "/transaction/a.b",
    `/transaction/${"a".repeat(129)}`,
    "/treasury//transactions",
    "/treasury/a/b/transactions",
    "/treasury/%2e%2e/transactions",
    "/treasury/a/transactions/",
    `/treasury/${"a".repeat(129)}/transactions`,
  ]) {
    assertThrows(() => assertMercuryGet("GET", path), Error, "mercury_path", path);
  }
});

function ledgerTransport() {
  const pages: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/treasury")) {
      return Promise.resolve(jsonResponse({ accounts: [{ id: TREASURY_A, name: "Treasury" }], page: {} }));
    }
    if (url.pathname.endsWith(`/treasury/${TREASURY_A}/transactions`)) {
      const cursor = url.searchParams.get("cursor");
      pages.push(cursor ?? "first");
      if (cursor == null) {
        return Promise.resolve(jsonResponse({
          transactions: [
            { id: "y-1", accountId: TREASURY_A, type: "interestPosted", amount: 1.5, canonicalDay: "2026-09-30" },
            { id: "y-2", accountId: TREASURY_A, type: "interestPosted", amount: 1.4, canonicalDay: "2026-08-31" },
          ],
          cursor: "page-2",
        }));
      }
      if (cursor === "page-2") {
        // A backdated cancel carries its original's day, inside the margin before the window.
        return Promise.resolve(jsonResponse({
          transactions: [
            { id: "c-1", accountId: TREASURY_A, type: "interestCanceled", amount: -1.3, canonicalDay: "2026-07-31" },
            { id: "y-3", accountId: TREASURY_A, type: "interestPosted", amount: 1.3, canonicalDay: "2026-07-31" },
            { id: "y-4", accountId: TREASURY_A, type: "interestPosted", amount: 1.2, canonicalDay: "2026-06-30" },
          ],
          cursor: "page-3",
        }));
      }
      return Promise.resolve(jsonResponse({
        transactions: [
          { id: "y-5", accountId: TREASURY_A, type: "interestPosted", amount: 1.1, canonicalDay: "2026-05-31" },
        ],
        cursor: null,
      }));
    }
    return Promise.resolve(jsonResponse({ transactions: [], page: {} }));
  };
  return { fetchImpl, pages };
}

Deno.test("a later sync stops the treasury ledger 60 days before the window start", async () => {
  const { fetchImpl, pages } = ledgerTransport();
  const session = openMercury("secret", { fetch: fetchImpl, now: () => NOW });
  assertEquals(mercuryTreasuryAccountCount(session), null);
  // The last sync was 2026-10-01, so the window starts 2026-09-01 and the read goes to 2026-07-03.
  const result = await fetchMercurySince(session, { cursor: "2026-10-01T00:00:00.000Z", importFrom: null, lookbackDays: 30 });
  assertEquals(result.complete, true);
  assertEquals(pages, ["first", "page-2"]);
  const ids = result.lines.map((row) => (row as { id: string }).id);
  assertEquals(ids.includes("c-1"), true);
  assertEquals(treasuryVoidIds(result.lines, [], 1), ["y-3"]);
  assertEquals(mercuryTreasuryAccountCount(session), 1);
});

Deno.test("the first sync still reads the whole treasury ledger", async () => {
  const { fetchImpl, pages } = ledgerTransport();
  const session = openMercury("secret", { fetch: fetchImpl, now: () => NOW });
  const result = await fetchMercurySince(session, { cursor: null, importFrom: null, lookbackDays: 30 });
  assertEquals(pages, ["first", "page-2", "page-3"]);
  const ids = result.lines.map((row) => (row as { id: string }).id).filter((id) => id.startsWith("y-"));
  assertEquals(ids, ["y-1", "y-2", "y-3", "y-4", "y-5"]);
});

function stored(externalId: string, accountId: string | null): TreasuryStoredLine {
  return { externalId, kind: "interestPosted", amountCents: 1234, accountId, docDate: "2026-09-30" };
}

function cancel(accountId: string | null) {
  return {
    id: "cancel-1",
    ...(accountId ? { accountId } : {}),
    type: "interestCanceled",
    amount: -12.34,
    canonicalDay: "2026-09-30",
  };
}

Deno.test("a treasury cancel voids the line on its own account first", () => {
  // Same kind, cents and day on both accounts: before FLOW-509 the unlabeled row made it ambiguous.
  const lines = [stored("on-a", TREASURY_A), stored("on-b", TREASURY_B), stored("old-unlabeled", null)];
  assertEquals(treasuryVoidIds([cancel(TREASURY_A)], lines, 2), ["on-a"]);
  assertEquals(treasuryVoidIds([cancel(TREASURY_B)], lines, 2), ["on-b"]);
});

Deno.test("an unlabeled line is voided only when the company has one treasury account", () => {
  const lines = [stored("old-unlabeled", null)];
  assertEquals(treasuryVoidIds([cancel(TREASURY_A)], lines, 1), ["old-unlabeled"]);
  assertEquals(treasuryVoidIds([cancel(TREASURY_A)], lines, 2), []);
  assertEquals(treasuryVoidIds([cancel(TREASURY_A)], lines, null), []);
  assertEquals(treasuryVoidIds([cancel(TREASURY_A)], lines, 0), []);
});

Deno.test("a cancel with no account matches only with one treasury account", () => {
  const lines = [stored("on-a", TREASURY_A)];
  assertEquals(treasuryVoidIds([cancel(null)], lines, 1), ["on-a"]);
  assertEquals(treasuryVoidIds([cancel(null)], lines, 2), []);
  // Another account's line is never the match, whatever the count.
  assertEquals(treasuryVoidIds([cancel(TREASURY_A)], [stored("on-b", TREASURY_B)], 1), []);
});
