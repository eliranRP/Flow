import { assertEquals } from "jsr:@std/assert@1";
import { CONNECTOR_RECHECK_LIMIT, planConnectorSync, type ConfirmResult, type StoredLine } from "./engine.ts";
import type {
  AccountLabel,
  CanonicalLine,
  ConnectorPort,
  ConnectorSession,
  FetchSinceResult,
  NormalizeContext,
} from "./types.ts";

const NOW = new Date("2026-10-04T08:00:00.000Z");

function session(): ConnectorSession {
  return { provider: "fixture" } as ConnectorSession;
}

function line(id: string): CanonicalLine {
  return {
    source: "fixture",
    external_id: id,
    direction: "income",
    line_status: "posted",
    doc_kind: "receipt",
    pnl_role: null,
    currency: "USD",
    amount_original: 100,
    amount_negated: false,
    doc_date: "2026-10-01",
    cash_date: "2026-10-01",
    source_account_id: "checking",
    counterparty: { name: null, external_id: null, kind: null },
    description: id,
    vat: { amount: 0, status: "source" },
    project_hint: null,
    category_hint: null,
    linked_external_id: null,
    provider_meta: {},
  };
}

function port(options: {
  accounts: AccountLabel[];
  fetched: FetchSinceResult;
  onNormalize?: (ctx: NormalizeContext) => void;
  failValidate?: boolean;
}): { port: ConnectorPort; validateCalls: () => number } {
  let validateCalls = 0;
  const adapter: ConnectorPort = {
    capabilities: { listing: "window", removal: "status", currencies: ["USD"], hasPending: true },
    allowlist: [],
    validate() {
      validateCalls += 1;
      if (options.failValidate) return Promise.resolve({ ok: false, class: "auth", retry_after: null });
      return Promise.resolve({ ok: true, accounts: options.accounts });
    },
    fetchSince() {
      return Promise.resolve(options.fetched);
    },
    normalize(raw, ctx) {
      options.onNormalize?.(ctx);
      const id = raw && typeof raw === "object" && "id" in raw && typeof raw.id === "string" ? raw.id : "";
      if (!id) return { ok: false, skip: "not_a_line" };
      return { ok: true, line: line(id) };
    },
    classifyError() {
      return { class: "rejected", retry_after: null };
    },
    redact(value) {
      return value;
    },
  };
  return { port: adapter, validateCalls: () => validateCalls };
}

const accounts: AccountLabel[] = [
  { id: "checking", label: "Checking" },
  { id: "credit", label: "Credit" },
  { id: "treasury", label: "Treasury" },
];

Deno.test("every validated account id is the own set, including one that was not connected before", async () => {
  let seen: readonly string[] = [];
  const built = port({
    accounts,
    fetched: {
      lines: [{ id: "move" }],
      removedIds: [],
      nextCursor: NOW.toISOString(),
      complete: true,
      windowStart: "2026-09-04",
    },
    onNormalize(ctx) {
      seen = ctx.ownAccountIds;
    },
  });
  const plan = await planConnectorSync({
    port: built.port,
    session: session(),
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored: [],
    now: () => NOW,
  });
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(seen, ["checking", "credit", "treasury"]);
  assertEquals(plan.ownAccountIds, ["checking", "credit", "treasury"]);
});

Deno.test("each sync validates again", async () => {
  const built = port({
    accounts,
    fetched: { lines: [], removedIds: [], nextCursor: NOW.toISOString(), complete: true, windowStart: null },
  });
  const input = {
    port: built.port,
    session: session(),
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored: [],
    now: () => NOW,
  };
  await planConnectorSync(input);
  await planConnectorSync(input);
  assertEquals(built.validateCalls(), 2);
});

Deno.test("a failed validation does not fetch", async () => {
  let fetched = false;
  const built = port({
    accounts,
    failValidate: true,
    fetched: { lines: [], removedIds: [], nextCursor: null, complete: true },
  });
  const original = built.port.fetchSince;
  built.port.fetchSince = () => {
    fetched = true;
    return original.call(built.port, session(), { cursor: null, importFrom: null, lookbackDays: 30 });
  };
  const plan = await planConnectorSync({
    port: built.port,
    session: session(),
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored: [],
    now: () => NOW,
  });
  assertEquals(plan, { ok: false, error: { class: "auth", retry_after: null }, code: "auth" });
  assertEquals(fetched, false);
});

Deno.test("an unfinished page keeps the resume cursor and does not recheck stored lines", async () => {
  let confirmed = 0;
  const built = port({
    accounts,
    fetched: {
      lines: [{ id: "page" }],
      removedIds: [],
      nextCursor: "{\"page\":\"cursor-20\"}",
      complete: false,
      windowStart: "2026-09-04",
    },
  });
  const stored: StoredLine[] = [{
    externalId: "old-posted",
    lineStatus: "posted",
    docDate: "2026-08-01",
    missingSince: null,
  }];
  const plan = await planConnectorSync({
    port: built.port,
    session: session(),
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored,
    now: () => NOW,
    confirmLine() {
      confirmed += 1;
      return Promise.resolve({ action: "void" });
    },
  });
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(plan.complete, false);
  assertEquals(plan.nextCursor, "{\"page\":\"cursor-20\"}");
  assertEquals(plan.removedIds, []);
  assertEquals(confirmed, 0);
});

Deno.test("a posted line outside the window is voided from a status recheck", async () => {
  const seen: string[] = [];
  const built = port({
    accounts,
    fetched: {
      lines: [{ id: "inside" }],
      removedIds: [],
      nextCursor: NOW.toISOString(),
      complete: true,
      windowStart: "2026-09-04",
    },
  });
  const stored: StoredLine[] = [
    { externalId: "inside", lineStatus: "posted", docDate: "2026-10-01", missingSince: null },
    { externalId: "old-posted", lineStatus: "posted", docDate: "2026-08-01", missingSince: null },
    { externalId: "recent-missing", lineStatus: "posted", docDate: "2026-10-02", missingSince: null },
    { externalId: "pending-gone", lineStatus: "pending", docDate: "2026-10-03", missingSince: null },
  ];
  const plan = await planConnectorSync({
    port: built.port,
    session: session(),
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored,
    now: () => NOW,
    confirmLine(storedLine): Promise<ConfirmResult> {
      seen.push(storedLine.externalId);
      if (storedLine.lineStatus === "pending") {
        return Promise.resolve({ action: "keep", missingSince: "2026-10-03T00:00:00.000Z" });
      }
      return Promise.resolve({ action: "void" });
    },
  });
  assertEquals(seen, ["old-posted", "pending-gone"]);
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(plan.removedIds, ["old-posted"]);
  assertEquals(plan.pendingMissing, [{
    externalId: "pending-gone",
    missingSince: "2026-10-03T00:00:00.000Z",
  }]);
  assertEquals(plan.rechecked.map((row) => row.externalId), ["old-posted", "pending-gone"]);
});

Deno.test("a sync rechecks at most 50 lines, oldest checked first", async () => {
  const seen: string[] = [];
  const built = port({
    accounts,
    fetched: {
      lines: [],
      removedIds: [],
      nextCursor: NOW.toISOString(),
      complete: true,
      windowStart: "2026-09-04",
    },
  });
  const stored: StoredLine[] = [];
  for (let index = 0; index < CONNECTOR_RECHECK_LIMIT + 1; index += 1) {
    const day = String(index + 1).padStart(2, "0");
    stored.push({
      externalId: `old-${day}`,
      lineStatus: "posted",
      docDate: `2026-01-${day}`,
      missingSince: null,
      checkedAt: index === CONNECTOR_RECHECK_LIMIT ? null : `2026-08-${day}T00:00:00.000Z`,
    });
  }
  await planConnectorSync({
    port: built.port,
    session: session(),
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored,
    now: () => NOW,
    confirmLine(storedLine): Promise<ConfirmResult> {
      seen.push(storedLine.externalId);
      return Promise.resolve({ action: "keep", missingSince: NOW.toISOString() });
    },
  });
  assertEquals(seen.length, CONNECTOR_RECHECK_LIMIT);
  assertEquals(seen[0], `old-${String(CONNECTOR_RECHECK_LIMIT + 1).padStart(2, "0")}`);
  assertEquals(seen.includes(`old-${String(CONNECTOR_RECHECK_LIMIT).padStart(2, "0")}`), false);
});

Deno.test("a rate-limited recheck keeps the line and does not fail the run", async () => {
  const built = port({
    accounts,
    fetched: {
      lines: [],
      removedIds: [],
      nextCursor: NOW.toISOString(),
      complete: true,
      windowStart: "2026-09-04",
    },
  });
  built.port.classifyError = () => ({ class: "rate_limited", retry_after: null });
  const plan = await planConnectorSync({
    port: built.port,
    session: session(),
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored: [{
      externalId: "old-posted",
      lineStatus: "posted",
      docDate: "2026-08-01",
      missingSince: null,
    }],
    now: () => NOW,
    confirmLine() {
      return Promise.reject(new Error("rate_limited"));
    },
  });
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(plan.removedIds, []);
  assertEquals(plan.rechecked, []);
});
