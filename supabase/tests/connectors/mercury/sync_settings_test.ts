// FLOW-1162: what mercury-sync keeps in a connection's settings between runs. The runs in a row on
// a repeated page token (the owner: stop after 3), and the ids a page-capped run listed, so the run
// that finishes the window does not spend its rechecks on them. Invented ids only.
import { assertEquals } from "jsr:@std/assert@1";
import { machineProblems } from "../../../../packages/shared/src/machine.ts";
import { CONNECTOR_RECHECK_LIMIT, planConnectorSync, type StoredLine } from "../../../functions/_shared/connectors/engine.ts";
import { mercuryAdapter } from "../../../functions/_shared/connectors/mercury/adapter.ts";
import { mercuryRepeatedPage } from "../../../functions/_shared/connectors/mercury/machines.ts";
import {
  REPEATED_PAGE_KEY,
  RESUME_LISTED_CAP,
  RESUME_LISTED_KEY,
  listedEarlier,
  repeatedPageEvent,
  repeatedPageSkips,
  repeatedPageState,
  withRepeatedPage,
  withResumeListed,
} from "../../../functions/_shared/connectors/mercury/sync_settings.ts";

const NOW = new Date("2026-10-04T08:00:00.000Z");
const CHECKING = "cccccccc-0000-4000-8000-00000000000c";
const AT = "2026-10-03T08:00:00.000Z";
const START = "2026-09-03";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function pendingRow(id: string): Record<string, unknown> {
  return {
    id,
    status: "pending",
    kind: "outgoingPayment",
    amount: -12.5,
    createdAt: "2026-09-10T10:00:00.000Z",
    counterpartyName: "Example Supplies",
    accountId: CHECKING,
  };
}

/** One checking account, no card or treasury; the pending list's pages by their start_after token. */
function transport(pending: (token: string | null) => { rows: unknown[]; next: string | null }): typeof fetch {
  return (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/accounts")) return Promise.resolve(jsonResponse({ accounts: [{ id: CHECKING, name: "Checking" }], page: {} }));
    if (url.pathname.endsWith("/credit")) return Promise.resolve(jsonResponse({ accounts: [] }));
    if (url.pathname.endsWith("/treasury")) return Promise.resolve(jsonResponse({ accounts: [], page: {} }));
    if (url.pathname.endsWith("/transactions") && url.searchParams.get("status") === "pending") {
      const page = pending(url.searchParams.get("start_after"));
      return Promise.resolve(jsonResponse({ transactions: page.rows, page: page.next ? { nextPage: page.next } : {} }));
    }
    return Promise.resolve(jsonResponse({ transactions: [], page: {} }));
  };
}

async function plan(fetchImpl: typeof fetch, cursor: string, stored: StoredLine[], earlier: readonly string[]) {
  const calls: string[] = [];
  const planned = await planConnectorSync({
    port: mercuryAdapter,
    session: mercuryAdapter.open("invented-key", { fetch: fetchImpl, now: () => NOW }),
    cursor,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored,
    listedEarlier: earlier,
    now: () => NOW,
    // As confirmStored on a 404: keep, and start the clock when none runs.
    confirmLine(line) {
      calls.push(line.externalId);
      return Promise.resolve({ action: "keep", missingSince: line.missingSince ?? NOW.toISOString() });
    },
  });
  return { planned, calls };
}

const resumeAt = (page: string, at = AT) => JSON.stringify({ at, start: START, page, phase: "pending" });

Deno.test("the repeated-page steps are a sound table: the third run in a row stops, any other ending clears", () => {
  assertEquals(machineProblems(mercuryRepeatedPage), []);
  let settings: Record<string, unknown> = { own_counterparty_ids: ["cp-1"] };
  const counts: unknown[] = [];
  for (let run = 0; run < 4; run += 1) {
    settings = withRepeatedPage(settings, mercuryRepeatedPage.next(repeatedPageState(settings), "repeated"));
    counts.push(settings[REPEATED_PAGE_KEY]);
  }
  assertEquals(counts, [1, 2, 3, 3]);
  assertEquals(repeatedPageState(settings), "stopped");
  settings = withRepeatedPage(settings, mercuryRepeatedPage.next(repeatedPageState(settings), "other"));
  assertEquals(settings, { own_counterparty_ids: ["cp-1"] });
  // Two in a row and then another ending start the count again.
  assertEquals(mercuryRepeatedPage.next("twice", "other"), "clear");
  assertEquals(repeatedPageState({ [REPEATED_PAGE_KEY]: "3" }), "clear");
  assertEquals(repeatedPageState({ [REPEATED_PAGE_KEY]: 9 }), "stopped");
});

Deno.test("a stopped connection is skipped by the drain and an unforced run; the owner's forced refresh runs it", () => {
  const stopped = { [REPEATED_PAGE_KEY]: 3 };
  assertEquals(repeatedPageSkips(stopped, { force: false, drained: true }), true);
  assertEquals(repeatedPageSkips(stopped, { force: true, drained: true }), true);
  assertEquals(repeatedPageSkips(stopped, { force: false, drained: false }), true);
  assertEquals(repeatedPageSkips(stopped, { force: true, drained: false }), false);
  assertEquals(repeatedPageSkips({ [REPEATED_PAGE_KEY]: 2 }, { force: false, drained: true }), false);
});

Deno.test("a page token Mercury sends twice fails the run, and counts as a repeated page", async () => {
  const looping = transport((token) => ({ rows: [pendingRow(`row-${token ?? "first"}`)], next: "same-token" }));
  const failed = await plan(looping, resumeAt("first"), [], []);
  assertEquals(failed.planned.ok, false);
  if (failed.planned.ok) return;
  assertEquals(failed.planned.code, "sync_page_cap");
  assertEquals(repeatedPageEvent(failed.planned.code), "repeated");
  assertEquals(repeatedPageEvent("transient"), "other");
  assertEquals(repeatedPageEvent(null), "other");
});

Deno.test("the run that finishes a page-capped window rechecks only lines neither run listed", async () => {
  // The partial run reads 20 pages of 3 pending lines from a resume in the pending list, and stops at the cap.
  const fetchImpl = transport((token) => {
    const index = token == null ? 0 : Number(token.slice(2));
    if (index >= 20) return { rows: [], next: null };
    return { rows: [0, 1, 2].map((slot) => pendingRow(`fill-${String(index * 3 + slot).padStart(2, "0")}`)), next: `p-${String(index + 1)}` };
  });
  const first = await plan(fetchImpl, resumeAt("p-0"), [], []);
  assertEquals(first.planned.ok, true);
  if (!first.planned.ok) return;
  assertEquals(first.planned.complete, false);
  assertEquals(first.planned.listed.length, 60);
  const settings = withResumeListed({ pending_missing: {} }, first.planned);
  const kept = settings[RESUME_LISTED_KEY] as { at: string; start: string; ids: string[] };
  assertEquals(Object.keys(kept).sort(), ["at", "ids", "start"]);
  assertEquals([kept.at, kept.start, kept.ids.length], [AT, START, 60]);

  // The lines the partial run imported are stored pending now, older than the two nobody listed.
  const stored: StoredLine[] = [
    ...kept.ids.map((id) => ({ externalId: id, lineStatus: "pending" as const, docDate: "2026-09-10", missingSince: null })),
    { externalId: "missing-new", lineStatus: "pending", docDate: "2026-09-25", missingSince: null },
    { externalId: "missing-waiting", lineStatus: "pending", docDate: "2026-09-26", missingSince: "2026-09-28T00:00:00.000Z" },
  ];
  const cursor = first.planned.nextCursor;
  assertEquals(typeof cursor, "string");
  if (typeof cursor !== "string") return;

  // Before FLOW-1162: the 50 rechecks go to lines the partial run listed, and the missing two wait.
  const before = await plan(fetchImpl, cursor, stored, []);
  assertEquals(before.calls.length, CONNECTOR_RECHECK_LIMIT);
  assertEquals(before.calls.includes("missing-new"), false);

  const resumed = await plan(fetchImpl, cursor, stored, listedEarlier(settings, cursor));
  assertEquals(resumed.planned.ok, true);
  if (!resumed.planned.ok) return;
  assertEquals(resumed.planned.complete, true);
  assertEquals(resumed.calls, ["missing-new", "missing-waiting"]);
  // A missing clock starts or goes on; a line the partial run listed has none.
  assertEquals(resumed.planned.pendingMissing, [
    { externalId: "missing-new", missingSince: NOW.toISOString() },
    { externalId: "missing-waiting", missingSince: "2026-09-28T00:00:00.000Z" },
  ]);
  // The run that finishes the window drops the list.
  assertEquals(RESUME_LISTED_KEY in withResumeListed(settings, resumed.planned), false);
});

Deno.test("a stored list is used only by a resume of its own window", () => {
  const settings = { [RESUME_LISTED_KEY]: { at: AT, start: START, ids: ["seen-1"] } };
  assertEquals(listedEarlier(settings, resumeAt("p-3")), ["seen-1"]);
  // A finished sync's timestamp, a cleared cursor (re-read, reconnect), another window: none.
  assertEquals(listedEarlier(settings, NOW.toISOString()), []);
  assertEquals(listedEarlier(settings, null), []);
  assertEquals(listedEarlier(settings, resumeAt("p-3", "2026-10-04T07:00:00.000Z")), []);
  assertEquals(listedEarlier(settings, JSON.stringify({ at: AT, start: "2026-09-04", page: "p-3", phase: "pending" })), []);
  // A partial run of a new window replaces a stale list instead of merging with it.
  const next = withResumeListed(settings, { complete: false, nextCursor: resumeAt("p-1", NOW.toISOString()), listed: ["new-1"] });
  assertEquals(next[RESUME_LISTED_KEY], { at: NOW.toISOString(), start: START, ids: ["new-1"] });
  // Merged within the same window.
  const merged = withResumeListed(settings, { complete: false, nextCursor: resumeAt("p-4"), listed: ["seen-2"] });
  assertEquals(merged[RESUME_LISTED_KEY], { at: AT, start: START, ids: ["seen-1", "seen-2"] });
});

Deno.test("a list over the cap is dropped for the rest of its window, not cut", () => {
  const many = Array.from({ length: RESUME_LISTED_CAP }, (_, index) => `id-${String(index).padStart(5, "0")}`);
  const full = withResumeListed({}, { complete: false, nextCursor: resumeAt("p-1"), listed: many });
  assertEquals(listedEarlier(full, resumeAt("p-1")).length, RESUME_LISTED_CAP);
  const over = withResumeListed(full, { complete: false, nextCursor: resumeAt("p-2"), listed: ["one-more"] });
  assertEquals(over[RESUME_LISTED_KEY], { at: AT, start: START, ids: null });
  assertEquals(listedEarlier(over, resumeAt("p-2")), []);
  // A later partial run of that window does not start a list without what the earlier ones listed.
  const later = withResumeListed(over, { complete: false, nextCursor: resumeAt("p-3"), listed: ["late-1"] });
  assertEquals(later[RESUME_LISTED_KEY], { at: AT, start: START, ids: null });
  assertEquals(listedEarlier(later, resumeAt("p-3")), []);
});
