// FLOW-1163: SUMIT's resumable pull. A fake SUMIT list (invented ids, sample amounts) and a fake store
// that follows upsert_sumit_window's contract (documents, a sweep only when complete, counting the
// earlier runs' ids as seen, the continuation in the same write). The SQL half is pgTAP
// (supabase/tests/database/sumit_window.test.sql).
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import { machineEdges, machineProblems } from "../../../../packages/shared/src/machine.ts";
import { linkedRateBp, type SumitDoc } from "../../../functions/_shared/ledger.ts";
import { PULL_REPEATS, sumitPull } from "../../../functions/_shared/connectors/sumit/machines.ts";
import { SUMIT_PAGE_CAP } from "../../../functions/_shared/connectors/sumit/pull.ts";
import { DEFERRED_CAP, pullSkips, pullState, readPull } from "../../../functions/_shared/connectors/sumit/pull_state.ts";
import { pullRun, type PullRunResult, type StorePlan, type WriteResult } from "../../../functions/_shared/connectors/sumit/run.ts";

const SUMIT_COMPANY = 4242;
const RATE_BP = 1700;
const PAGE = 1000;

function invoice(id: number, vat = 17): Record<string, unknown> {
  return {
    ID: id,
    Accounting_DefinitionEnum: [7],
    Accounting_DisplayCompanyValue: [117],
    Accounting_DisplayCompanyValueWithoutVAT: [100],
    Accounting_VATRate: [vat],
    Accounting_Date: ["2026-03-04T00:00:00"],
    Accounting_Customer: [{ ID: 900, Name: "Example Customer" }],
  };
}

function receipt(id: number, original: number): Record<string, unknown> {
  return { ...invoice(id), Accounting_DefinitionEnum: [11], Accounting_OriginalDocument: [{ ID: original }] };
}

/** SUMIT's documents list: offset paging, 1,000 rows a page, HasNextPage on every page but the last. */
class FakeSumit {
  rows: Record<string, unknown>[];
  asked: number[] = [];
  /** Throws on the n-th page request of a run (a run killed while listing). */
  killAfter: number | null = null;
  constructor(count: number) {
    this.rows = Array.from({ length: count }, (_, index) => invoice(index + 1));
  }
  async page(start: number): Promise<Record<string, unknown>> {
    if (this.killAfter != null && this.asked.length >= this.killAfter) throw new Error("killed");
    this.asked.push(start);
    const slice = this.rows.slice(start, start + PAGE);
    return await Promise.resolve({ Status: 0, Data: { Entities: slice, HasNextPage: start + PAGE < this.rows.length } });
  }
}

/** upsert_sumit_documents / upsert_sumit_window as the database defines them. */
class FakeDb {
  stored = new Map<number, SumitDoc>();
  writes = new Map<number, number>();
  settings: Record<string, unknown> = {};
  sweeps = 0;
  removed: number[] = [];
  stamps = 0;
  windowFunction = true;
  killWrite = false;
  paths: string[] = [];

  write(plan: StorePlan): WriteResult {
    if (plan.path === "window" && !this.windowFunction) return { saved: false, reason: "missing", reads: 0 };
    if (this.killWrite) throw new Error("killed");
    this.paths.push(`${plan.path}:${plan.complete ? "complete" : "partial"}`);
    for (const doc of plan.batch) {
      this.stored.set(doc.sumit_id, doc);
      this.writes.set(doc.sumit_id, (this.writes.get(doc.sumit_id) ?? 0) + 1);
    }
    if (plan.complete) {
      this.sweeps += 1;
      const seen = new Set(plan.batch.map((doc) => doc.sumit_id));
      for (const id of [...this.stored.keys()]) {
        if (seen.has(id)) continue;
        this.stored.delete(id);
        this.removed.push(id);
      }
    }
    if (plan.pull == null) delete this.settings.pull;
    else this.settings.pull = JSON.parse(JSON.stringify(plan.pull));
    return { saved: true, reads: 0 };
  }

  /** One run, as sumit-sync's runSync glues it: a finished window stamps, a stuck one ends in sync_page_cap. */
  async run(sumit: FakeSumit, options: { invoicesCap?: number; cap?: number } = {}): Promise<PullRunResult> {
    sumit.asked = [];
    const ran = await pullRun({
      settings: this.settings,
      sumitCompanyId: SUMIT_COMPANY,
      companyRateBp: RATE_BP,
      now: "2026-11-15T03:00:00.000Z",
      fetchPage: (start) => sumit.page(start),
      write: (plan) => Promise.resolve(this.write(plan)),
      ...options,
    });
    if (ran.finished) this.stamps += 1;
    return ran;
  }
}

const pull = (db: FakeDb) => readPull(db.settings, SUMIT_COMPANY);

Deno.test("sumitPull is a sound table", () => {
  assertEquals(machineProblems(sumitPull), []);
  assertEquals(machineEdges(sumitPull).length, 13);
  // The stored repeat counts are the table's steps: a repeat walks resuming, once, twice, stuck.
  let state: keyof typeof sumitPull.states = "resuming";
  const walked: number[] = [];
  for (let step = 0; step < 4; step += 1) {
    walked.push(PULL_REPEATS[state as keyof typeof PULL_REPEATS]);
    state = sumitPull.next(state, "repeated");
  }
  assertEquals(walked, [0, 1, 2, 3]);
  assertEquals(sumitPull.next("stuck", "capped"), "resuming");
  assertEquals(sumitPull.next("stuck", "finished"), "complete");
});

Deno.test("a 45-page window completes in three runs and stores every document once", async () => {
  const sumit = new FakeSumit(45 * PAGE);
  const db = new FakeDb();
  const first = await db.run(sumit);
  assertFalse(first.finished);
  assertEquals(sumit.asked.length, SUMIT_PAGE_CAP);
  assertEquals(db.stored.size, 20 * PAGE);
  assertEquals(pull(db)?.start, 20 * PAGE);
  const second = await db.run(sumit);
  assertFalse(second.finished);
  // A resumed run asks from the row before the continuation (to check the list did not shift), so
  // each resume lists one row fewer than a full 20 pages.
  assertEquals(db.stored.size, 40 * PAGE - 1);
  assertEquals(pull(db)?.start, 40 * PAGE - 1);
  assertEquals(db.sweeps, 0, "no sweep on the first two runs");
  assertEquals(db.stamps, 0, "a partial run does not stamp");
  const third = await db.run(sumit);
  assert(third.finished);
  assertEquals(db.stored.size, 45 * PAGE);
  assert([...db.writes.values()].every((count) => count === 1), "every document stored once");
  assertEquals(db.sweeps, 0, "the run that finishes a resumed window does not sweep either");
  assertEquals(db.removed, []);
  assertEquals(db.stamps, 1, "but it stamps the sync: the documents are in");
  assertEquals(pull(db), null);
  assertEquals(db.settings.pull, undefined);
  // The resumed runs asked from the row before the continuation.
  assertEquals(sumit.asked[0], 40 * PAGE - 2);
});

Deno.test("a window that took three runs removes nothing, even a stored document no run listed", async () => {
  const sumit = new FakeSumit(45 * PAGE);
  const db = new FakeDb();
  const stale = 777_777;
  db.stored.set(stale, { ...(invoice(stale) as unknown as SumitDoc), sumit_id: stale });
  await db.run(sumit);
  await db.run(sumit);
  assert(db.stored.has(stale), "a partial run never sweeps");
  const last = await db.run(sumit);
  assert(last.finished);
  assertEquals(last.plan.complete, false, "the finishing run stores with complete false");
  assertEquals(db.paths.at(-1), "window:partial");
  assertEquals(db.sweeps, 0);
  assertEquals(db.removed, []);
  assert(db.stored.has(stale), "a missed removal is recoverable; a wrong one is not");
  assertEquals(db.stored.size, 45 * PAGE + 1);
  assertEquals(db.stamps, 1);
  assertEquals(pull(db), null);
});

Deno.test("a receipt of an invoice listed in an earlier run waits, and is stored at the final run, when the invoice list went over its bound", async () => {
  const rows: Record<string, unknown>[] = Array.from({ length: 6 * PAGE }, (_, index) => invoice(index + 1));
  rows[4_000] = receipt(4_001, 5); // run 3: its invoice is in run 1
  const sumit = new FakeSumit(0);
  sumit.rows = rows;
  const db = new FakeDb();
  const options = { cap: 2, invoicesCap: 2_500 };
  await db.run(sumit, options);
  assertEquals(pull(db)?.invoices?.length, 2 * PAGE);
  await db.run(sumit, options);
  assertEquals(pull(db)?.invoices, null, "over the bound the list is dropped, not cut");
  await db.run(sumit, options);
  assertEquals(pull(db)?.deferred.map((doc) => doc.sumit_id), [4_001], "so the receipt waits");
  const last = await db.run(sumit, options);
  assert(last.finished);
  assert(db.stored.has(4_001), "and is stored by the run that finishes, at the company rate");
  assertEquals(db.stored.size, 6 * PAGE);
  assertEquals(db.sweeps, 0);
});

Deno.test("a continuation that keeps repeating is skipped by the cron and tried by a forced refresh", async () => {
  const sumit = new FakeSumit(45 * PAGE);
  const db = new FakeDb();
  await db.run(sumit);
  const states: string[] = [pullState(db.settings, SUMIT_COMPANY)];
  for (let run = 0; run < 3; run += 1) {
    // A row is added ahead of the continuation before every run, so the list shifts under it.
    sumit.rows.unshift(invoice(100_000 + run));
    const ran = await db.run(sumit);
    assertEquals(ran.plan.event, "repeated");
    states.push(pullState(db.settings, SUMIT_COMPANY));
    assertEquals(ran.stuck, run === 2);
  }
  assertEquals(states, ["resuming", "once", "twice", "stuck"]);
  assertEquals(db.sweeps, 0, "a repeating window never sweeps");
  const settings = db.settings;
  assert(pullSkips(settings, SUMIT_COMPANY, { force: false, drained: true }), "the cron skips it");
  assert(pullSkips(settings, SUMIT_COMPANY, { force: true, drained: true }), "a forced request in the drain skips it");
  assert(pullSkips(settings, SUMIT_COMPANY, { force: false, drained: false }), "an unforced manual run skips it");
  assertFalse(pullSkips(settings, SUMIT_COMPANY, { force: true, drained: false }), "the owner's own refresh still tries");
  // The owner's refresh, with the list holding still, moves the continuation on and ends the count.
  const forced = await db.run(sumit);
  assertEquals(forced.plan.event, "capped");
  assertEquals(pullState(db.settings, SUMIT_COMPANY), "resuming");
  assertEquals(pull(db)?.start, 40 * PAGE - 1);
});

Deno.test("a run killed while listing writes nothing and the next run goes on from the same continuation", async () => {
  const sumit = new FakeSumit(45 * PAGE);
  const db = new FakeDb();
  await db.run(sumit);
  const before = JSON.stringify(db.settings);
  const storedBefore = db.stored.size;
  sumit.killAfter = 7;
  let killed = false;
  try {
    await db.run(sumit);
  } catch (error) {
    killed = (error as Error).message === "killed";
  }
  assert(killed);
  assertEquals(JSON.stringify(db.settings), before);
  assertEquals(db.stored.size, storedBefore);
  sumit.killAfter = null;
  await db.run(sumit);
  const last = await db.run(sumit);
  assert(last.finished);
  assertEquals(db.stored.size, 45 * PAGE);
  assert([...db.writes.values()].every((count) => count === 1));
});

Deno.test("a run killed in the write leaves the earlier state, and the continuation never passes stored documents", async () => {
  const sumit = new FakeSumit(45 * PAGE);
  const db = new FakeDb();
  await db.run(sumit);
  db.killWrite = true;
  let killed = false;
  try {
    await db.run(sumit);
  } catch {
    killed = true;
  }
  assert(killed);
  db.killWrite = false;
  // Whatever the state, every document before the continuation is stored.
  const at = pull(db)?.start ?? 0;
  for (let id = 1; id <= at; id += 1) assert(db.stored.has(id), `document ${id} is stored`);
  // Starting over from nothing (the settings lost) stores the same documents again, unchanged.
  db.settings = {};
  const again = await db.run(sumit);
  assertFalse(again.finished);
  assertEquals(db.stored.size, 20 * PAGE);
  assertEquals(db.writes.get(1), 2, "the page stored twice is the same row written twice");
});

Deno.test("an uncapped run behaves as before", async () => {
  const sumit = new FakeSumit(3 * PAGE + 17);
  const db = new FakeDb();
  const stale = 777_777;
  db.stored.set(stale, { ...(invoice(stale) as unknown as SumitDoc), sumit_id: stale });
  const ran = await db.run(sumit);
  assert(ran.finished);
  assertEquals(ran.documents, 3 * PAGE + 17);
  assertEquals(ran.plan.path, "plain", "upsert_sumit_documents, as before");
  assertEquals(ran.plan.pull, null);
  assertEquals(ran.reads, 4);
  assertEquals(sumit.asked, [0, 1000, 2000, 3000]);
  assertEquals(db.removed, [stale], "the sweep removes what the run did not see");
  assertEquals(db.stamps, 1);
});

Deno.test("a window of exactly the page cap ends in one run and sweeps; one that ends on the next run's check row does not", async () => {
  const exact = new FakeSumit(SUMIT_PAGE_CAP * PAGE);
  const db = new FakeDb();
  const ran = await db.run(exact);
  assert(ran.finished, "HasNextPage is false on the 20th page");
  assertEquals(db.sweeps, 1);
  // The 20th page says HasNextPage but the list ends there: the next run asks from the last row and ends.
  const odd = new FakeSumit(SUMIT_PAGE_CAP * PAGE);
  const original = odd.page.bind(odd);
  odd.page = async (start: number) => {
    const payload = await original(start);
    const data = payload.Data as { HasNextPage: boolean };
    data.HasNextPage = start + PAGE <= SUMIT_PAGE_CAP * PAGE;
    return payload;
  };
  const dbOdd = new FakeDb();
  const first = await dbOdd.run(odd);
  assertFalse(first.finished);
  assertEquals(dbOdd.sweeps, 0);
  const second = await dbOdd.run(odd);
  assert(second.finished);
  assertEquals(second.documents, 0);
  assertEquals(dbOdd.sweeps, 0, "it took two runs");
  assertEquals(dbOdd.stored.size, SUMIT_PAGE_CAP * PAGE);
});

Deno.test("on a database without the window function a capped run fails as before and writes nothing", async () => {
  const sumit = new FakeSumit(25 * PAGE);
  const db = new FakeDb();
  db.windowFunction = false;
  let failure = "";
  try {
    await db.run(sumit);
  } catch (error) {
    failure = (error as Error).message;
  }
  assertEquals(failure, "sync_page_cap");
  assertEquals(db.stored.size, 0);
  assertEquals(db.settings, {});
  // An uncapped run needs no new function.
  const small = await db.run(new FakeSumit(30));
  assertEquals(small.plan.path, "plain");
  assertEquals(db.stored.size, 30);
});

Deno.test("a pull of another SUMIT company, or a malformed one, is not resumed", async () => {
  const sumit = new FakeSumit(25 * PAGE);
  const db = new FakeDb();
  await db.run(sumit);
  const stored = JSON.parse(JSON.stringify(db.settings)) as Record<string, { company: number }>;
  assertEquals(readPull(stored, SUMIT_COMPANY + 1), null);
  const broken = { pull: { ...stored.pull, invoices: "all" } };
  assertEquals(readPull(broken, SUMIT_COMPANY), null);
  assertEquals(pullState(broken, SUMIT_COMPANY), "fresh");
  db.settings = broken;
  const ran = await db.run(sumit);
  assertEquals(sumit.asked[0], 0, "a pull that cannot be read starts over");
  assertFalse(ran.finished);
  assertEquals(pull(db)?.start, 20 * PAGE);
});

Deno.test("a receipt listed before its invoice waits for it, and one after it takes the invoice's rate", async () => {
  // A page cap of 2 pages: two partial runs and a finishing one.
  const rows: Record<string, unknown>[] = Array.from({ length: 5 * PAGE }, (_, index) => invoice(index + 1));
  rows[10] = receipt(11, 5_000); // run 1; its invoice (id 5,000, VAT 0) is in run 3
  rows[2_500] = invoice(2_501, 0); // run 2: an exempt invoice
  rows[2_600] = receipt(2_601, 2_501); // run 2: its receipt, same run
  rows[4_000] = receipt(4_001, 2_501); // run 3: a receipt for run 2's exempt invoice
  rows[4_500] = receipt(4_501, 123_456); // run 3: its invoice is not in SUMIT at all
  rows[4_999] = invoice(5_000, 0);
  const sumit = new FakeSumit(0);
  sumit.rows = rows;
  const db = new FakeDb();
  const rate = (plan: StorePlan, id: number) => {
    const doc = plan.lookup.get(id);
    return doc == null ? RATE_BP : linkedRateBp(doc, RATE_BP);
  };
  const one = await db.run(sumit, { cap: 2 });
  assertFalse(db.stored.has(11), "a receipt whose invoice is not listed yet is held back");
  assertEquals(pull(db)?.deferred.map((doc) => doc.sumit_id), [11]);
  assertEquals(one.plan.batch.length, 2 * PAGE - 1);
  const two = await db.run(sumit, { cap: 2 });
  assertEquals(rate(two.plan, 2_501), 0);
  assertEquals(two.plan.batch.some((doc) => doc.sumit_id === 2_601), true, "a receipt of an invoice in the same run is stored");
  assertEquals(pull(db)?.rates, { "2501": 0 });
  const three = await db.run(sumit, { cap: 2 });
  assert(three.finished);
  assertEquals(rate(three.plan, 2_501), 0, "a receipt of an earlier run's exempt invoice takes its rate");
  assertEquals(rate(three.plan, 5_000), 0, "the held receipt meets its invoice");
  assert(db.stored.has(11) && db.stored.has(4_001) && db.stored.has(4_501));
  assertEquals(db.stored.size, 5 * PAGE);
});

Deno.test("receipts held over the bound fail the run as before", async () => {
  const rows: Record<string, unknown>[] = Array.from(
    { length: 5 * PAGE },
    (_, index) => (index < DEFERRED_CAP + 1 ? receipt(index + 1, 900_000 + index) : invoice(index + 1)),
  );
  const sumit = new FakeSumit(0);
  sumit.rows = rows;
  const db = new FakeDb();
  let failure = "";
  try {
    await db.run(sumit, { cap: 2 });
  } catch (error) {
    failure = (error as Error).message;
  }
  assertEquals(failure, "sync_page_cap");
  assertEquals(db.stored.size, 0);
});

Deno.test("a continuation whose last row has no id cannot be checked later, so the run fails as before", async () => {
  const sumit = new FakeSumit(25 * PAGE);
  sumit.rows[20 * PAGE - 1] = { ...invoice(20_000), ID: "x" };
  const db = new FakeDb();
  let failure = "";
  try {
    await db.run(sumit);
  } catch (error) {
    failure = (error as Error).message;
  }
  assertEquals(failure, "sync_page_cap");
  assertEquals(db.stored.size, 0);
  assertEquals(db.settings, {});
});

Deno.test("a window restarted by a shifted list that then ends in one run sweeps and clears the pull", async () => {
  const sumit = new FakeSumit(25 * PAGE);
  const db = new FakeDb();
  await db.run(sumit);
  // The list shrinks to 15 pages ahead of the continuation: the run starts over and lists it whole.
  sumit.rows = sumit.rows.slice(10 * PAGE);
  const stale = 777_777;
  db.stored.set(stale, { ...(invoice(stale) as unknown as SumitDoc), sumit_id: stale });
  const ran = await db.run(sumit);
  assert(ran.finished);
  assertEquals(ran.plan.path, "window", "the stale pull key is cleared by the write");
  assertEquals(ran.plan.complete, true, "the whole window was listed in this one run");
  assertEquals(db.sweeps, 1);
  assertEquals(db.removed.includes(stale), true);
  assertEquals(pull(db), null);
});
