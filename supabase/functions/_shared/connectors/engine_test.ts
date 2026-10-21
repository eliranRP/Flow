import { assertEquals } from "jsr:@std/assert@1";
import { CONNECTOR_RECHECK_LIMIT, planConnectorSync, type ConfirmResult, type StoredLine } from "./engine.ts";
import { MERCURY_TRANSFER_SKIPS } from "./mercury/capabilities.ts";
import { normalizeMercury, treasuryVoidIds } from "./mercury/normalize.ts";
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

Deno.test("FLOW-938: a scoped run owns the chosen accounts and every connection's; the rest are unsynced", async () => {
  const contexts: NormalizeContext[] = [];
  const built = port({
    accounts,
    fetched: { lines: [{ id: "move" }], removedIds: [], nextCursor: NOW.toISOString(), complete: true, windowStart: null },
    onNormalize(ctx) {
      contexts.push(ctx);
    },
  });
  const plan = await planConnectorSync({
    port: built.port,
    session: session(),
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    ownCounterpartyIds: [],
    // "gone" is no longer listed; "other-ops" is another connection's synced account.
    accountScope: { synced: ["checking", "gone"], own: ["checking", "other-ops"] },
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored: [],
    now: () => NOW,
  });
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(contexts[0]?.ownAccountIds, ["checking", "other-ops"]);
  assertEquals(contexts[0]?.unsyncedAccountIds, ["credit", "treasury"]);
  assertEquals(plan.ownAccountIds, ["checking", "other-ops"]);
  assertEquals(plan.accounts.map((account) => account.id), ["checking", "credit", "treasury"]);
  assertEquals(plan.org, null);
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
  assertEquals(plan.rateLimited, { retryAfter: null });
});

Deno.test("a rate-limited recheck stops calling, backs off, and keeps every pending clock", async () => {
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
  built.port.classifyError = () => ({ class: "rate_limited", retry_after: "2026-10-04T09:00:00.000Z" });
  const stored: StoredLine[] = [
    { externalId: "pending-a", lineStatus: "pending", docDate: "2026-09-20", missingSince: "2026-10-01T00:00:00.000Z" },
    { externalId: "pending-b", lineStatus: "pending", docDate: "2026-09-21", missingSince: null },
    { externalId: "pending-c", lineStatus: "pending", docDate: "2026-09-22", missingSince: "2026-10-02T00:00:00.000Z" },
    { externalId: "old-posted", lineStatus: "posted", docDate: "2026-08-01", missingSince: null },
  ];
  const calls: string[] = [];
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
    confirmLine(line) {
      calls.push(line.externalId);
      return Promise.reject(new Error("rate_limited"));
    },
  });
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(calls.length, 1);
  assertEquals(plan.rateLimited, { retryAfter: "2026-10-04T09:00:00.000Z" });
  assertEquals(plan.rechecked, []);
  const clocks = new Map(plan.pendingMissing.map((item) => [item.externalId, item.missingSince]));
  assertEquals(clocks.get("pending-a"), "2026-10-01T00:00:00.000Z");
  assertEquals(clocks.get("pending-c"), "2026-10-02T00:00:00.000Z");
  assertEquals(plan.removedIds, []);
});

Deno.test("a transient recheck error keeps going and is not a back-off", async () => {
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
  built.port.classifyError = () => ({ class: "transient", retry_after: null });
  const calls: string[] = [];
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
    stored: [
      { externalId: "old-1", lineStatus: "posted", docDate: "2026-08-01", missingSince: null },
      { externalId: "old-2", lineStatus: "posted", docDate: "2026-08-02", missingSince: null },
    ],
    now: () => NOW,
    confirmLine(line) {
      calls.push(line.externalId);
      return Promise.reject(new Error("transient"));
    },
  });
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(calls, ["old-1", "old-2"]);
  assertEquals(plan.rateLimited, null);
});

Deno.test("a refetched yield and its stored copy still void on a cancel", async () => {
  const interest = {
    id: "11111111-1111-4111-8111-111111111111",
    accountId: "treasury",
    type: "interestPosted",
    amount: 12.34,
    canonicalDay: "2026-09-30",
  };
  const cancel = {
    id: "99999999-9999-4999-8999-999999999999",
    accountId: "treasury",
    type: "interestCanceled",
    amount: -12.34,
    canonicalDay: "2026-09-30",
  };
  const built = port({
    accounts,
    fetched: {
      lines: [interest, cancel],
      removedIds: [],
      nextCursor: NOW.toISOString(),
      complete: true,
      windowStart: "2026-09-04",
    },
  });
  const storedYield = {
    externalId: interest.id,
    kind: "interestPosted",
    amountCents: 1234,
    accountId: "treasury",
    docDate: "2026-09-30",
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
    stored: [{
      externalId: interest.id,
      lineStatus: "posted",
      docDate: "2026-09-30",
      missingSince: null,
    }],
    now: () => NOW,
    resolveRemovedIds: (raw) => treasuryVoidIds(raw, [storedYield]),
  });
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(plan.removedIds.includes(interest.id), true);
});

Deno.test("a cancel that arrives in a later sync still voids the stored yield", async () => {
  const interestId = "11111111-1111-4111-8111-111111111111";
  const cancel = {
    id: "99999999-9999-4999-8999-999999999998",
    accountId: "treasury",
    type: "interestCanceled",
    amount: -12.34,
    canonicalDay: "2026-09-30",
  };
  const built = port({
    accounts,
    fetched: {
      lines: [cancel],
      removedIds: [],
      nextCursor: NOW.toISOString(),
      complete: true,
      windowStart: "2026-09-04",
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
    stored: [{
      externalId: interestId,
      lineStatus: "posted",
      docDate: "2026-09-30",
      missingSince: null,
    }],
    now: () => NOW,
    resolveRemovedIds: (raw) => treasuryVoidIds(raw, [{
      externalId: interestId,
      kind: "interestPosted",
      amountCents: 1234,
      accountId: "treasury",
      docDate: "2026-09-30",
    }]),
  });
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(plan.removedIds.includes(interestId), true);
  assertEquals(plan.removedIds.filter((id) => id === interestId).length, 1);
});

Deno.test("pending lines past the recheck cap keep their missing clock", async () => {
  const built = port({
    accounts,
    fetched: { lines: [], removedIds: [], nextCursor: NOW.toISOString(), complete: true, windowStart: "2026-09-04" },
  });
  const stored: StoredLine[] = [];
  for (let index = 0; index < CONNECTOR_RECHECK_LIMIT + 2; index += 1) {
    stored.push({
      externalId: `pending-${String(index).padStart(2, "0")}`,
      lineStatus: "pending",
      docDate: "2026-09-20",
      missingSince: "2026-10-01T00:00:00.000Z",
    });
  }
  let calls = 0;
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
    confirmLine(line) {
      calls += 1;
      return Promise.resolve({ action: "keep", missingSince: line.missingSince ?? NOW.toISOString() });
    },
  });
  assertEquals(plan.ok, true);
  if (!plan.ok) return;
  assertEquals(calls, CONNECTOR_RECHECK_LIMIT);
  assertEquals(plan.pendingMissing.length, CONNECTOR_RECHECK_LIMIT + 2);
  const last = plan.pendingMissing.find((item) => item.externalId === `pending-${CONNECTOR_RECHECK_LIMIT + 1}`);
  assertEquals(last?.missingSince, "2026-10-01T00:00:00.000Z");
  assertEquals(plan.rateLimited, null);
});

Deno.test("a transfer imported as money out to a new account is voided once that account syncs (FLOW-938)", async () => {
  // Mercury opens "acct-new"; the owner funds it from the synced "acct-chk" before answering.
  const fund = {
    id: "tx-fund",
    status: "sent",
    kind: "internalTransfer",
    accountId: "acct-chk",
    counterpartyId: "acct-new",
    counterpartyName: "Mercury Checking ••0002",
    amount: -500,
    createdAt: "2026-10-02T10:00:00Z",
    postedAt: "2026-10-02T10:00:00Z",
  };
  const arrive = { ...fund, id: "tx-arrive", accountId: "acct-new", counterpartyId: "acct-chk", amount: 500 };
  const mercuryPort = (lines: unknown[]): ConnectorPort => ({
    ...port({ accounts: [], fetched: { lines: [], removedIds: [], nextCursor: null, complete: true } }).port,
    validate: () => Promise.resolve({ ok: true, accounts: [{ id: "acct-chk", label: "Checking" }, { id: "acct-new", label: "New" }] }),
    fetchSince: () => Promise.resolve({ lines, removedIds: [], nextCursor: "c", complete: true }),
    normalize: normalizeMercury,
  });
  const stored = new Set<string>();
  const base = {
    session: session(),
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    stored: [],
    now: () => NOW,
    voidStoredSkips: {
      reasons: MERCURY_TRANSFER_SKIPS,
      storedIds: (ids: readonly string[]) => Promise.resolve(ids.filter((id) => stored.has(id))),
    },
  };

  // Before the answer "acct-new" is not synced: the funding is money out, hinted to transfers.
  const before = await planConnectorSync({
    ...base,
    port: mercuryPort([fund, arrive]),
    ownCounterpartyIds: ["acct-new"],
    accountScope: { synced: ["acct-chk"], own: ["acct-chk"] },
  });
  assertEquals(before.ok, true);
  if (!before.ok) return;
  assertEquals(before.lines.map((item) => [item.external_id, item.category_hint]), [["tx-fund", "העברות"]]);
  assertEquals(before.removedIds, []);
  for (const item of before.lines) stored.add(item.external_id);

  // The owner answers yes: both legs are a transfer between synced accounts, and the stored leg goes.
  const after = await planConnectorSync({
    ...base,
    port: mercuryPort([fund, arrive]),
    ownCounterpartyIds: [],
    accountScope: { synced: ["acct-chk", "acct-new"], own: ["acct-chk", "acct-new"] },
  });
  assertEquals(after.ok, true);
  if (!after.ok) return;
  assertEquals(after.lines, []);
  assertEquals(after.skips.map((item) => [item.externalId, item.reason]), [
    ["tx-fund", "internal_transfer"],
    ["tx-arrive", "internal_transfer"],
  ]);
  assertEquals(after.removedIds, ["tx-fund"]);
});

Deno.test("a skipped transfer that was never stored voids nothing, and a failed lookup fails the run", async () => {
  const fund = {
    id: "tx-own",
    status: "sent",
    kind: "internalTransfer",
    accountId: "acct-chk",
    counterpartyId: "acct-sav",
    amount: -10,
    createdAt: "2026-10-02T10:00:00Z",
    postedAt: "2026-10-02T10:00:00Z",
  };
  const adapter: ConnectorPort = {
    ...port({ accounts: [], fetched: { lines: [], removedIds: [], nextCursor: null, complete: true } }).port,
    validate: () => Promise.resolve({ ok: true, accounts: [{ id: "acct-chk", label: "C" }, { id: "acct-sav", label: "S" }] }),
    fetchSince: () => Promise.resolve({ lines: [fund], removedIds: [], nextCursor: "c", complete: true }),
    normalize: normalizeMercury,
  };
  const input = {
    port: adapter,
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
  const asked: string[][] = [];
  const none = await planConnectorSync({
    ...input,
    voidStoredSkips: { reasons: MERCURY_TRANSFER_SKIPS, storedIds: (ids) => { asked.push([...ids]); return Promise.resolve([]); } },
  });
  assertEquals(none.ok && none.removedIds, []);
  assertEquals(asked, [["tx-own"]]);
  const failed = await planConnectorSync({
    ...input,
    voidStoredSkips: { reasons: MERCURY_TRANSFER_SKIPS, storedIds: () => Promise.reject(new Error("could not read stored lines")) },
  });
  assertEquals(failed.ok, false);
});
