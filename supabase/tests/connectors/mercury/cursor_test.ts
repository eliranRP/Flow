import { assertEquals } from "jsr:@std/assert@1";
import { machineEdges, machineProblems } from "../../../../packages/shared/src/machine.ts";
import { encodeMercuryResume, fetchMercurySince, openMercury } from "../../../functions/_shared/connectors/mercury/client.ts";
import { mercuryCommit, mercuryFetchPhases, mercuryPhasesFrom } from "../../../functions/_shared/connectors/mercury/machines.ts";

const NOW = new Date("2026-10-04T08:00:00.000Z");
const FIRST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccc09";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

Deno.test("the fetch phases and the commit steps are sound tables", () => {
  assertEquals(machineProblems(mercuryFetchPhases), []);
  assertEquals(machineProblems(mercuryCommit), []);
  assertEquals(machineEdges(mercuryFetchPhases).map((edge) => `${edge.from}>${edge.to}`), [
    "window>pending",
    "pending>treasury",
    "treasury>done",
  ]);
});

Deno.test("a resume at a phase runs that phase and every later one", () => {
  assertEquals(mercuryPhasesFrom("window"), ["window", "pending", "treasury"]);
  assertEquals(mercuryPhasesFrom("pending"), ["pending", "treasury"]);
  assertEquals(mercuryPhasesFrom("treasury"), ["treasury"]);
});

Deno.test("the commit stamps the sync only after the labels of a complete fetch", () => {
  const complete = ["saved", "labeled", "stamped"] as const;
  assertEquals(complete.reduce((step, event) => mercuryCommit.next(step, event), mercuryCommit.initial), "done");
  const partial = ["saved", "partial"] as const;
  assertEquals(partial.reduce((step, event) => mercuryCommit.next(step, event), mercuryCommit.initial), "done");
  assertEquals(mercuryCommit.can("lines", "stamped"), false);
  assertEquals(mercuryCommit.can("labels", "stamped"), false);
});

Deno.test("a treasury resume whose account is gone restarts the ledger without the old page token", async () => {
  const cursor = encodeMercuryResume({
    at: NOW.toISOString(),
    start: "2026-08-15",
    page: "7",
    phase: "treasury",
    treasuryId: GONE,
  });
  const ledgerCalls: URL[] = [];
  const fetchImpl: typeof fetch = (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.includes("/treasury/") && url.pathname.endsWith("/transactions")) {
      ledgerCalls.push(url);
      return Promise.resolve(jsonResponse({ transactions: [{ id: "first-yield" }], cursor: null }));
    }
    if (url.pathname.endsWith("/treasury")) {
      return Promise.resolve(jsonResponse({ accounts: [{ id: FIRST, status: "active" }], page: {} }));
    }
    return Promise.resolve(jsonResponse({ transactions: [{ id: "bank-should-not-load" }], page: {} }));
  };
  const result = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, { fetch: fetchImpl, now: () => NOW }), {
    cursor,
    importFrom: null,
    lookbackDays: 30,
  });
  assertEquals(result.complete, true);
  assertEquals(result.windowStart, "2026-08-15");
  assertEquals(ledgerCalls.map((url) => url.pathname), [`/api/v1/treasury/${FIRST}/transactions`]);
  assertEquals(ledgerCalls[0]?.searchParams.has("cursor"), false);
  assertEquals(result.lines.map((row) => (row as { id?: string }).id), ["first-yield"]);
});
