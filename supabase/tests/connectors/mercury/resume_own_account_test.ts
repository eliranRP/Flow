// FLOW-509 follow-up: tests for the checks a mutation pass showed no test covered.
// The resume cursor's field checks, the treasury resume reaching only the resumed account,
// and the own-account and card-account checks in normalizeMercury.
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { decodeMercuryCursor, fetchMercurySince, openMercury } from "../../../functions/_shared/connectors/mercury/client.ts";
import { MercuryCardAccountError, normalizeMercury } from "../../../functions/_shared/connectors/mercury/normalize.ts";
import type { NormalizeContext } from "../../../functions/_shared/connectors/types.ts";

const NOW = new Date("2026-10-04T08:00:00.000Z");
const CHECKING = "cccccccc-0000-4000-8000-00000000000c";
const CARD = "dddddddd-0000-4000-8000-00000000000d";
const TREASURY_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TREASURY_B = "bbbbbbbb-0000-4000-8000-00000000000b";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

Deno.test("a resume cursor drops a start, page or treasury id it cannot use", () => {
  const cursor = (fields: Record<string, unknown>) =>
    decodeMercuryCursor(JSON.stringify({ at: "2026-10-01T00:00:00.000Z", phase: "treasury", ...fields }));
  assertEquals(cursor({ start: "2026-09-01", page: "p-2", treasuryId: TREASURY_A }), {
    at: "2026-10-01T00:00:00.000Z",
    start: "2026-09-01",
    page: "p-2",
    phase: "treasury",
    treasuryId: TREASURY_A,
  });
  assertEquals(cursor({ start: "September" }).start, null);
  assertEquals(cursor({ start: "2026-09-01T00:00:00Z" }).start, null);
  assertEquals(cursor({ page: "" }).page, null);
  assertEquals(cursor({ treasuryId: "" }).treasuryId, null);
  assertEquals(decodeMercuryCursor("{not json"), { at: null, start: null, page: null, phase: "window", treasuryId: null });
});

Deno.test("a treasury resume applies its page to the resumed account only", async () => {
  const reads: string[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/treasury")) {
      return Promise.resolve(jsonResponse({
        accounts: [{ id: TREASURY_A, name: "Treasury A" }, { id: TREASURY_B, name: "Treasury B" }],
        page: {},
      }));
    }
    for (const id of [TREASURY_A, TREASURY_B]) {
      if (url.pathname.endsWith(`/treasury/${id}/transactions`)) {
        reads.push(`${id === TREASURY_A ? "A" : "B"}:${url.searchParams.get("cursor") ?? "first"}`);
        return Promise.resolve(jsonResponse({
          transactions: [{ id: `y-${id.slice(0, 1)}`, accountId: id, type: "interestPosted", amount: 1.5, canonicalDay: "2026-09-30" }],
          cursor: null,
        }));
      }
    }
    return Promise.resolve(jsonResponse({ transactions: [], page: {} }));
  };
  const session = openMercury("secret", { fetch: fetchImpl, now: () => NOW });
  const resume = JSON.stringify({ at: "2026-10-01T00:00:00.000Z", start: null, page: "a-page-2", phase: "treasury", treasuryId: TREASURY_A });
  const result = await fetchMercurySince(session, { cursor: resume, importFrom: null, lookbackDays: 30 });
  assertEquals(result.complete, true);
  assertEquals(reads, ["A:a-page-2", "B:first"]);

  reads.length = 0;
  const onB = JSON.stringify({ at: "2026-10-01T00:00:00.000Z", start: null, page: "b-page-2", phase: "treasury", treasuryId: TREASURY_B });
  await fetchMercurySince(openMercury("secret", { fetch: fetchImpl, now: () => NOW }), { cursor: onB, importFrom: null, lookbackDays: 30 });
  assertEquals(reads, ["B:b-page-2"]);
});

function ctx(ownAccountIds: string[]): NormalizeContext {
  return {
    ownAccountIds,
    ownCounterpartyIds: [],
    vatRateBp: 1800,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    linkedDocuments: [],
  };
}

function line(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "txn-own-1",
    status: "sent",
    kind: "outgoingPayment",
    amount: -42.5,
    createdAt: "2026-09-20T10:00:00.000Z",
    postedAt: "2026-09-21T10:00:00.000Z",
    counterpartyName: "Example Supplies",
    counterpartyId: "cp-1",
    accountId: CHECKING,
    ...fields,
  };
}

Deno.test("card spend needs a known card account only when the company lists its accounts", () => {
  const card = { kind: "debitCardTransaction", accountId: CARD };
  assertEquals(normalizeMercury(line(card), ctx([])).ok, true);
  assertEquals(normalizeMercury(line(card), ctx([CHECKING, CARD])).ok, true);
  assertThrows(() => normalizeMercury(line(card), ctx([CHECKING])), MercuryCardAccountError);
  assertThrows(() => normalizeMercury(line({ ...card, accountId: undefined }), ctx([CHECKING, CARD])), MercuryCardAccountError);
});

Deno.test("a line with no account is not one of the connected accounts", () => {
  assertEquals(normalizeMercury(line({ accountId: undefined }), ctx([CHECKING])), { ok: false, skip: "not_own_account" });
  assertEquals(normalizeMercury(line({ accountId: undefined }), ctx([])).ok, true);
});

Deno.test("an overlong account or counterparty id is not a line", () => {
  const long = "x".repeat(129);
  assertEquals(normalizeMercury(line({ counterpartyId: long }), ctx([CHECKING])), { ok: false, skip: "not_a_line" });
  assertEquals(normalizeMercury(line({ accountId: long }), ctx([CHECKING])), { ok: false, skip: "not_a_line" });
  assertEquals(normalizeMercury(line({ accountId: long }), ctx([])), { ok: false, skip: "not_a_line" });
});
