import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import page1 from "./fixtures/transactions-desc-page1.json" with { type: "json" };
import page2 from "./fixtures/transactions-desc-page2.json" with { type: "json" };
import accountsFile from "./fixtures/accounts.json" with { type: "json" };
import creditFile from "./fixtures/credit.json" with { type: "json" };
import treasuryFile from "./fixtures/treasury.json" with { type: "json" };
import treasuryTxns from "./fixtures/SYNTHETIC-treasury-transactions.json" with { type: "json" };
import syntheticPending from "./fixtures/SYNTHETIC-pending.json" with { type: "json" };
import { assertMercuryGet } from "../../../functions/_shared/connectors/mercury/guard.ts";
import { MERCURY_PAGE_CAP, MERCURY_POSTED_LOOKBACK_DAYS } from "../../../functions/_shared/connectors/mercury/capabilities.ts";
import { jerusalemDate } from "../../../functions/_shared/connectors/mercury/dates.ts";
import {
  MercuryPageCapError,
  MercuryRequestError,
  backoffUntil,
  classifyMercuryError,
  decodeMercuryCursor,
  encodeMercuryResume,
  fetchMercurySince,
  getMercuryTransaction,
  listMercuryCardLabels,
  mercuryAccountsChanged,
  mercuryFailureCode,
  mercuryStartDate,
  openMercury,
  pendingAbsenceVoids,
  recheckMissingPending,
  retryAfterToIso,
  timestampFromCursor,
  validateMercury,
} from "../../../functions/_shared/connectors/mercury/client.ts";
import { normalizeMercury } from "../../../functions/_shared/connectors/mercury/normalize.ts";

const NOW = new Date("2026-10-04T08:00:00.000Z");

interface Call {
  url: URL;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Bank-listing tests do not stub the treasury ledger. An empty ledger is a successful account list. */
function bankTransport(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  return transport((url, init) => {
    if (url.pathname.includes("/treasury/") && url.pathname.endsWith("/transactions")) {
      return jsonResponse({ transactions: [], cursor: null });
    }
    if (url.pathname.endsWith("/treasury")) return jsonResponse({ accounts: [], page: {} });
    return handler(url, init);
  });
}

function transport(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const request = init ?? {};
    calls.push({ url, init: request });
    return Promise.resolve(handler(url, request));
  };
  return { fetchImpl, calls };
}

Deno.test("the posted lookback is 30 days and clamps to import_from", () => {
  assertEquals(MERCURY_POSTED_LOOKBACK_DAYS, 30);
  assertEquals(mercuryStartDate({
    lastSyncAt: "2026-10-04T08:00:00.000Z",
    importFrom: null,
    lookbackDays: 30,
  }), "2026-09-04");
  assertEquals(mercuryStartDate({
    lastSyncAt: "2026-10-04T08:00:00.000Z",
    importFrom: "2026-10-01",
    lookbackDays: 30,
  }), "2026-10-01");
  assertEquals(mercuryStartDate({
    lastSyncAt: null,
    importFrom: null,
    lookbackDays: 30,
  }), null);
  assertEquals(mercuryStartDate({
    lastSyncAt: null,
    importFrom: "2026-08-01",
    lookbackDays: 30,
  }), "2026-08-01");
});

Deno.test("paging follows nextPage with no overlap and stops when it is absent", async () => {
  const token = `test-${crypto.randomUUID()}`;
  const { fetchImpl, calls } = bankTransport((url) => {
    if (url.searchParams.get("status") === "pending") {
      return jsonResponse({ transactions: [], page: {} });
    }
    const startAfter = url.searchParams.get("start_after");
    if (!startAfter) return jsonResponse(page1);
    if (startAfter === page1.page.nextPage) return jsonResponse(page2);
    return jsonResponse({ transactions: [], page: {} });
  });
  const session = openMercury(token, { fetch: fetchImpl, now: () => NOW });
  const result = await fetchMercurySince(session, { cursor: null, importFrom: null, lookbackDays: 30 });
  assertEquals(result.complete, true);
  assertEquals(result.nextCursor, NOW.toISOString());
  const ids = result.lines.map((row) => (row as { id: string }).id);
  assertEquals(new Set(ids).size, 100);
  assertEquals(result.removedIds.length, 6);
  assertEquals(calls[0].url.searchParams.has("start_after"), false);
  assertEquals(calls[0].url.searchParams.has("start"), false);
  assertEquals(calls[0].url.searchParams.get("limit"), "100");
  assertEquals(calls[0].url.searchParams.get("order"), "desc");
  assertEquals(calls[1].url.searchParams.get("start_after"), page1.page.nextPage);
  assertEquals(calls[2].url.searchParams.get("start_after"), page2.page.nextPage);
  const page1Ids = new Set(page1.transactions.map((row) => row.id));
  const page2Ids = page2.transactions.map((row) => row.id);
  assertEquals(page2Ids.some((id) => page1Ids.has(id)), false);
  for (const call of calls) {
    assertEquals(call.init.method, "GET");
    assertEquals(call.init.redirect, "error");
    assertEquals(call.url.hostname, "api.mercury.com");
    assertEquals(call.url.pathname.startsWith("/api/v1/"), true);
    assertEquals(call.url.href.includes(token), false);
    const headers = call.init.headers as { Authorization: string };
    assertEquals(headers.Authorization, `Bearer ${token}`);
  }
});

Deno.test("a later sync sends start from the cursor minus the lookback", async () => {
  const { fetchImpl, calls } = bankTransport(() => jsonResponse({ transactions: [], page: {} }));
  const session = openMercury(`test-${crypto.randomUUID()}`, { fetch: fetchImpl, now: () => NOW });
  await fetchMercurySince(session, {
    cursor: "2026-10-04T08:00:00.000Z",
    importFrom: "2026-10-01",
    lookbackDays: MERCURY_POSTED_LOOKBACK_DAYS,
  });
  assertEquals(calls[0].url.searchParams.get("start"), "2026-10-01");
  assertEquals(calls[1].url.searchParams.get("status"), "pending");
  assertEquals(calls[1].url.searchParams.has("start"), false);
});

Deno.test("401, 403, 429, and 5xx classify, and the error does not echo the token", async () => {
  const token = `test-${crypto.randomUUID()}`;
  const now = NOW;
  const cases = [
    { status: 401, errorClass: "auth" as const, retry: null },
    { status: 403, errorClass: "auth" as const, retry: null },
    { status: 429, errorClass: "rate_limited" as const, retry: new Date(now.getTime() + 30_000).toISOString() },
    { status: 500, errorClass: "transient" as const, retry: null },
    { status: 503, errorClass: "transient" as const, retry: null },
  ];
  for (const item of cases) {
    const { fetchImpl } = transport(() => jsonResponse(
      { error: `secret-token:${token}`, Authorization: `Bearer ${token}` },
      item.status,
      item.status === 429 ? { "retry-after": "30" } : {},
    ));
    const session = openMercury(token, { fetch: fetchImpl, now: () => now });
    const error = await assertRejects(() => fetchMercurySince(session, {
      cursor: null,
      importFrom: null,
      lookbackDays: 30,
    }));
    assertEquals(classifyMercuryError(error), { class: item.errorClass, retry_after: item.retry, code: item.errorClass });
    assertEquals(String(error).includes(token), false);
    assertEquals(String(error).includes(`secret-token:${token}`), false);
  }
  assertEquals(retryAfterToIso("30", now), new Date(now.getTime() + 30_000).toISOString());
});

Deno.test("an empty secret fails closed and does not call Mercury", async () => {
  let called = false;
  const fetchImpl: typeof fetch = () => {
    called = true;
    return Promise.resolve(jsonResponse({}));
  };
  const session = openMercury("  ", { fetch: fetchImpl, now: () => NOW });
  const result = await validateMercury(session);
  assertEquals(result, { ok: false, class: "auth", retry_after: null, code: "auth" });
  assertEquals(called, false);
});

Deno.test("validate reads accounts, credit, and treasury and returns ids and labels only", async () => {
  const token = `test-${crypto.randomUUID()}`;
  const { fetchImpl, calls } = transport((url) => {
    if (url.pathname.endsWith("/credit")) return jsonResponse(creditFile);
    if (url.pathname.endsWith("/treasury")) return jsonResponse(treasuryFile);
    if (url.pathname.endsWith("/accounts")) return jsonResponse(accountsFile);
    return jsonResponse({ transactions: [], page: {} });
  });
  const session = openMercury(token, { fetch: fetchImpl, now: () => NOW });
  const result = await validateMercury(session);
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(
    result.accounts.length,
    accountsFile.accounts.length + creditFile.accounts.length + treasuryFile.accounts.length,
  );
  const text = JSON.stringify(result.accounts);
  assertEquals(text.includes(token), false);
  assertEquals(text.includes("availableBalance"), false);
  assertEquals(text.includes("routingNumber"), false);
  assertEquals(text.includes("0000"), false);
  assertEquals(text.includes("****"), true);
  const credit = result.accounts.find((account) => account.id === creditFile.accounts[0].id);
  assertEquals(credit?.label, "Mercury Credit");
  const treasury = result.accounts.find((account) => account.id === treasuryFile.accounts[0].id);
  assertEquals(treasury?.label, "Mercury Treasury");
  assertEquals(calls.every((call) => call.init.method === "GET"), true);
  assertEquals(calls.some((call) => call.url.pathname.endsWith("/treasury")), true);
});

Deno.test("an unreachable treasury account refuses validation", async () => {
  const down = transport((url) => {
    if (url.pathname.endsWith("/treasury")) return jsonResponse({ error: "unavailable" }, 503);
    if (url.pathname.endsWith("/credit")) return jsonResponse(creditFile);
    if (url.pathname.endsWith("/accounts")) return jsonResponse(accountsFile);
    return jsonResponse({ accounts: [], page: {} });
  });
  const refused = await validateMercury(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: down.fetchImpl,
    now: () => NOW,
  }));
  assertEquals(refused.ok, false);
  if (refused.ok) return;
  assertEquals(refused.class, "transient");

  const malformed = transport((url) => {
    if (url.pathname.endsWith("/treasury")) return jsonResponse({ page: {} });
    if (url.pathname.endsWith("/credit")) return jsonResponse(creditFile);
    if (url.pathname.endsWith("/accounts")) return jsonResponse(accountsFile);
    return jsonResponse({ accounts: [], page: {} });
  });
  assertEquals(
    await validateMercury(openMercury(`test-${crypto.randomUUID()}`, {
      fetch: malformed.fetchImpl,
      now: () => NOW,
    })),
    { ok: false, class: "rejected", retry_after: null, code: "rejected" },
  );
});

Deno.test("an empty treasury list is a successful validation", async () => {
  const { fetchImpl } = transport((url) => {
    if (url.pathname.endsWith("/treasury")) return jsonResponse({ accounts: [], page: {} });
    if (url.pathname.endsWith("/credit")) return jsonResponse(creditFile);
    if (url.pathname.endsWith("/accounts")) return jsonResponse(accountsFile);
    return jsonResponse({ accounts: [], page: {} });
  });
  const result = await validateMercury(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: fetchImpl,
    now: () => NOW,
  }));
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.accounts.some((account) => account.label === "Mercury Treasury"), false);
  assertEquals(result.accounts.length, accountsFile.accounts.length + creditFile.accounts.length);
});

Deno.test("401, 403, and 404 from treasury refuse validation", async () => {
  const { fetchImpl } = transport((url) => {
    if (url.pathname.endsWith("/treasury")) return jsonResponse({ error: "no" }, 401);
    if (url.pathname.endsWith("/credit")) return jsonResponse(creditFile);
    if (url.pathname.endsWith("/accounts")) return jsonResponse(accountsFile);
    return jsonResponse({ accounts: [], page: {} });
  });
  const refused = await validateMercury(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: fetchImpl,
    now: () => NOW,
  }));
  assertEquals(refused.ok, false);
  if (refused.ok) return;
  assertEquals(refused.class, "auth");
  assertEquals(refused.code, "auth");

  for (const status of [403, 404] as const) {
    const refusedTreasury = transport((url) => {
      if (url.pathname.endsWith("/treasury")) return jsonResponse({ error: "no" }, status);
      if (url.pathname.endsWith("/credit")) return jsonResponse(creditFile);
      if (url.pathname.endsWith("/accounts")) return jsonResponse(accountsFile);
      if (url.pathname.endsWith("/transactions")) {
        return jsonResponse({
          transactions: [{
            id: "liquidation-1",
            kind: "other",
            status: "sent",
            amount: 25000,
            createdAt: "2026-10-01T12:00:00.000Z",
            postedAt: "2026-10-01T12:00:00.000Z",
            bankDescription: "Liquidation of Treasury assets",
          }],
          page: {},
        });
      }
      return jsonResponse({ accounts: [], page: {} });
    });
    const session = openMercury(`test-${crypto.randomUUID()}`, {
      fetch: refusedTreasury.fetchImpl,
      now: () => NOW,
    });
    const result = await validateMercury(session);
    assertEquals(result.ok, false);
    if (result.ok) return;
    assertEquals(result.class, status === 403 ? "auth" : "rejected");
    await assertRejects(
      () => fetchMercurySince(session, { cursor: null, importFrom: null, lookbackDays: 30 }),
      Error,
    );
  }
});

Deno.test("a treasury row with no id refuses validation", async () => {
  const logged: unknown[] = [];
  const previous = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    for (const accounts of [
      [{}],
      [{ status: "active", name: "secret-token:should-not-log" }],
      [{ id: "   ", name: "Mercury Treasury" }],
      [{ id: "abc/def", name: "Mercury Treasury" }],
    ]) {
      const { fetchImpl } = transport((url) => {
        if (url.pathname.endsWith("/treasury")) return jsonResponse({ accounts, page: {} });
        if (url.pathname.endsWith("/credit")) return jsonResponse(creditFile);
        if (url.pathname.endsWith("/accounts")) return jsonResponse(accountsFile);
        return jsonResponse({ accounts: [], page: {} });
      });
      const result = await validateMercury(openMercury(`test-${crypto.randomUUID()}`, {
        fetch: fetchImpl,
        now: () => NOW,
      }));
      assertEquals(result, { ok: false, class: "rejected", retry_after: null, code: "rejected" });
    }
  } finally {
    console.error = previous;
  }
  assertEquals(logged.length, 4);
  assertEquals(JSON.stringify(logged).includes("secret-token:should-not-log"), false);
  assertEquals(JSON.stringify(logged).includes("mercury_treasury_account_id"), true);
});

Deno.test("the page cap returns the fetched lines and a resume cursor", async () => {
  const token = `test-${crypto.randomUUID()}`;
  let pages = 0;
  const { fetchImpl } = bankTransport(() => {
    pages += 1;
    return jsonResponse({
      transactions: [{ id: `id-${pages}` }],
      page: { nextPage: `cursor-${pages}` },
    });
  });
  const session = openMercury(token, { fetch: fetchImpl, now: () => NOW });
  const result = await fetchMercurySince(session, {
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
  });
  assertEquals(pages, MERCURY_PAGE_CAP);
  assertEquals(result.complete, false);
  assertEquals(result.lines.length, MERCURY_PAGE_CAP);
  for (let page = 1; page <= MERCURY_PAGE_CAP; page += 1) {
    assertEquals(result.lines.some((row) => (row as { id?: string }).id === `id-${page}`), true);
  }
  const cursor = decodeMercuryCursor(result.nextCursor);
  assertEquals(cursor.phase, "window");
  assertEquals(cursor.page, `cursor-${MERCURY_PAGE_CAP}`);
  assertEquals(cursor.at, NOW.toISOString());
  assertEquals(result.nextCursor?.includes(token), false);
});

Deno.test("a missing pending line voids on 404 only after the wait, and a posted GET updates", async () => {
  const pending = syntheticPending.transactions[0];
  const token = `test-${crypto.randomUUID()}`;
  const missingLong = "2026-09-01T00:00:00.000Z";
  const missingShort = "2026-10-03T00:00:00.000Z";
  assertEquals(pendingAbsenceVoids(missingLong, NOW), true);
  assertEquals(pendingAbsenceVoids(missingShort, NOW), false);
  assertEquals(pendingAbsenceVoids("not-a-date", NOW), false);

  const missing = openMercury(token, {
    fetch: () => Promise.resolve(jsonResponse({ errors: { notFound: ["missing"] } }, 404)),
    now: () => NOW,
  });
  assertEquals(await getMercuryTransaction(missing, pending.id), null);
  assertEquals(
    await recheckMissingPending(missing, pending.id, missingLong, NOW),
    { action: "void" },
  );
  assertEquals(
    await recheckMissingPending(missing, pending.id, missingShort, NOW),
    { action: "keep" },
  );

  const posted = openMercury(token, {
    fetch: () => Promise.resolve(jsonResponse(pending)),
    now: () => NOW,
  });
  const update = await recheckMissingPending(posted, pending.id, missingLong, NOW);
  assertEquals(update.action, "update");
  if (update.action !== "update") return;
  const line = normalizeMercury(update.raw, {
    ownAccountIds: [pending.accountId],
    ownCounterpartyIds: [],
    vatRateBp: 0,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    linkedDocuments: [],
  });
  assertEquals(line.ok, true);
  if (!line.ok) return;
  assertEquals(line.line.external_id, pending.id);

  const failed = openMercury(token, {
    fetch: () => Promise.resolve(jsonResponse({ ...pending, status: "failed", postedAt: null })),
    now: () => NOW,
  });
  assertEquals(
    await recheckMissingPending(failed, pending.id, missingShort, NOW),
    { action: "void" },
  );
});

Deno.test("categories is a GET path and a redirect is not followed", async () => {
  assertMercuryGet("GET", "/categories");
  assertThrows(() => assertMercuryGet("GET", "/treasury/../transactions"), Error, "mercury_path");
  assertThrows(() => assertMercuryGet("GET", "/transaction/.."), Error, "mercury_path");
  const { fetchImpl, calls } = transport(() => {
    throw new TypeError("redirect mode is set to error");
  });
  const session = openMercury(`test-${crypto.randomUUID()}`, { fetch: fetchImpl, now: () => NOW });
  const result = await validateMercury(session);
  assertEquals(result, { ok: false, class: "rejected", retry_after: null, code: "rejected" });
  assertEquals(calls.length, 1);
});

Deno.test("import_from drops a line whose Jerusalem date is earlier", async () => {
  const early = {
    ...page1.transactions[0],
    id: "before-import-from",
    createdAt: "2026-08-01T12:00:00.000Z",
  };
  const late = {
    ...page1.transactions[1],
    id: "inside-import-from",
    createdAt: "2026-10-02T18:30:00.000Z",
  };
  const { fetchImpl } = bankTransport((url) => {
    if (url.searchParams.get("status") === "pending") return jsonResponse({ transactions: [], page: {} });
    if (!url.searchParams.get("start_after")) return jsonResponse({ transactions: [early, late], page: {} });
    return jsonResponse({ transactions: [], page: {} });
  });
  const session = openMercury(`test-${crypto.randomUUID()}`, { fetch: fetchImpl, now: () => NOW });
  const result = await fetchMercurySince(session, {
    cursor: null,
    importFrom: "2026-10-01",
    lookbackDays: 30,
  });
  const ids = result.lines.map((row) => (row as { id: string }).id);
  assertEquals(ids.includes("before-import-from"), false);
  assertEquals(ids.includes("inside-import-from"), true);
  const oldDay = {
    ...page1.transactions[0],
    id: "old-canonical-day",
    createdAt: "2026-10-02T18:30:00.000Z",
    canonicalDay: "2020-01-02",
  };
  const { fetchImpl: dayFetch } = bankTransport((url) => {
    if (url.searchParams.get("status") === "pending") return jsonResponse({ transactions: [], page: {} });
    if (!url.searchParams.get("start_after")) return jsonResponse({ transactions: [oldDay], page: {} });
    return jsonResponse({ transactions: [], page: {} });
  });
  const byDay = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: dayFetch,
    now: () => NOW,
  }), {
    cursor: null,
    importFrom: "2026-10-01",
    lookbackDays: 30,
  });
  assertEquals(byDay.lines.some((row) => (row as { id?: string }).id === "old-canonical-day"), false);
  assertEquals(jerusalemDate(late.createdAt) >= "2026-10-01", true);
});

Deno.test("a repeated nextPage stops instead of paging forever", async () => {
  let pages = 0;
  const { fetchImpl } = bankTransport((url) => {
    if (url.searchParams.get("status") === "pending") return jsonResponse({ transactions: [], page: {} });
    pages += 1;
    return jsonResponse({
      transactions: [{ id: `repeat-${pages}` }],
      page: { nextPage: "same-cursor" },
    });
  });
  const session = openMercury(`test-${crypto.randomUUID()}`, { fetch: fetchImpl, now: () => NOW });
  const error = await assertRejects(() => fetchMercurySince(session, {
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
  }));
  assertEquals(error instanceof MercuryPageCapError, true);
  if (!(error instanceof MercuryPageCapError)) return;
  assertEquals(error.resumeAfter, null);
  assertEquals(pages, 2);
});

Deno.test("the lookback does not include a reversal older than 30 days, and a resume cursor keeps the same start", () => {
  const start = mercuryStartDate({
    lastSyncAt: "2026-10-04T08:00:00.000Z",
    importFrom: null,
    lookbackDays: MERCURY_POSTED_LOOKBACK_DAYS,
  });
  assertEquals(start, "2026-09-04");
  assertEquals(jerusalemDate("2026-08-01T12:00:00.000Z") < (start ?? ""), true);
  const loop = new MercuryPageCapError([{ id: "kept" }], null);
  assertEquals(loop.code, "sync_page_cap");
  assertEquals(loop.resumeAfter, null);
  assertEquals(classifyMercuryError(loop), { class: "rejected", retry_after: null, code: "sync_page_cap" });
  const resumed = encodeMercuryResume({
    at: "2026-10-04T08:00:00.000Z",
    start,
    page: "cursor-20",
    phase: "window",
  });
  assertEquals(decodeMercuryCursor(resumed), {
    at: "2026-10-04T08:00:00.000Z",
    start,
    page: "cursor-20",
    phase: "window",
    treasuryId: null,
  });
  assertEquals(timestampFromCursor(resumed), null);
});

Deno.test("a resumed sync repeats the same start and continues after the page", async () => {
  const cursor = encodeMercuryResume({
    at: NOW.toISOString(),
    start: "2026-09-04",
    page: "cursor-20",
    phase: "window",
  });
  const { fetchImpl, calls } = bankTransport(() => jsonResponse({ transactions: [], page: {} }));
  const result = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: fetchImpl,
    now: () => NOW,
  }), {
    cursor,
    importFrom: null,
    lookbackDays: 30,
  });
  const window = calls.find((call) =>
    call.url.pathname.endsWith("/transactions") && call.url.searchParams.get("status") !== "pending"
  );
  assertEquals(window?.url.searchParams.get("start"), "2026-09-04");
  assertEquals(window?.url.searchParams.get("start_after"), "cursor-20");
  assertEquals(window?.url.search.includes("start=2026-09-04"), true);
  assertEquals(result.complete, true);
  assertEquals(result.windowStart, "2026-09-04");
});

Deno.test("a treasury-phase resume continues that account and skips the bank window", async () => {
  const treasuryId = treasuryFile.accounts[0].id;
  const cursor = encodeMercuryResume({
    at: NOW.toISOString(),
    start: "2026-09-04",
    page: "7",
    phase: "treasury",
    treasuryId,
  });
  const { fetchImpl, calls } = transport((url) => {
    if (url.pathname.includes("/treasury/") && url.pathname.endsWith("/transactions")) {
      return jsonResponse({ transactions: [], cursor: null });
    }
    if (url.pathname.endsWith("/treasury")) return jsonResponse(treasuryFile);
    return jsonResponse({ transactions: [{ id: "bank-should-not-load" }], page: {} });
  });
  const result = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: fetchImpl,
    now: () => NOW,
  }), {
    cursor,
    importFrom: null,
    lookbackDays: 30,
  });
  assertEquals(result.lines.some((row) => (row as { id?: string }).id === "bank-should-not-load"), false);
  const ledger = calls.find((call) => call.url.pathname === `/api/v1/treasury/${treasuryId}/transactions`);
  assertEquals(ledger?.url.searchParams.get("cursor"), "7");
  assertEquals(calls.some((call) => call.url.pathname.endsWith("/transactions") && !call.url.pathname.includes("/treasury/")), false);
});

Deno.test("treasury yield is read from the treasury transactions endpoint", async () => {
  const { fetchImpl, calls } = transport((url) => {
    if (url.pathname.includes("/treasury/") && url.pathname.endsWith("/transactions")) {
      return jsonResponse(treasuryTxns);
    }
    if (url.pathname.endsWith("/treasury")) return jsonResponse(treasuryFile);
    return jsonResponse({ transactions: [], page: {} });
  });
  const result = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: fetchImpl,
    now: () => NOW,
  }), {
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
  });
  const ids = result.lines.map((row) => (row as { id: string }).id);
  assertEquals(ids.includes(treasuryTxns.transactions[0].id), true);
  assertEquals(ids.includes(treasuryTxns.transactions[1].id), true);
  assertEquals(ids.includes(treasuryTxns.transactions[2].id), true);
  assertEquals(
    calls.some((call) => call.url.pathname === `/api/v1/treasury/${treasuryFile.accounts[0].id}/transactions`),
    true,
  );
  assertEquals(calls.every((call) => call.init.method === "GET"), true);
});

Deno.test("a pending page cap keeps the posted window lines", async () => {
  let pendingPages = 0;
  const { fetchImpl } = bankTransport((url) => {
    if (url.searchParams.get("status") === "pending") {
      pendingPages += 1;
      return jsonResponse({
        transactions: [{ id: `pending-${pendingPages}` }],
        page: { nextPage: `pending-cursor-${pendingPages}` },
      });
    }
    if (!url.searchParams.get("start_after")) {
      return jsonResponse({ transactions: [{ id: "window-kept" }], page: {} });
    }
    return jsonResponse({ transactions: [], page: {} });
  });
  const result = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: fetchImpl,
    now: () => NOW,
  }), {
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
  });
  assertEquals(pendingPages, MERCURY_PAGE_CAP);
  assertEquals(result.complete, false);
  assertEquals(result.lines.some((row) => (row as { id?: string }).id === "window-kept"), true);
  assertEquals(result.lines.some((row) => (row as { id?: string }).id === "pending-1"), true);
  assertEquals(decodeMercuryCursor(result.nextCursor).phase, "pending");
});

Deno.test("a resumed sync keeps a start date that is not the recomputed lookback", async () => {
  const cursor = encodeMercuryResume({
    at: NOW.toISOString(),
    start: "2026-08-15",
    page: "cursor-20",
    phase: "window",
  });
  const { fetchImpl, calls } = bankTransport(() => jsonResponse({ transactions: [], page: {} }));
  const result = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: fetchImpl,
    now: () => NOW,
  }), {
    cursor,
    importFrom: null,
    lookbackDays: 30,
  });
  const window = calls.find((call) =>
    call.url.pathname.endsWith("/transactions") && call.url.searchParams.get("status") !== "pending"
  );
  assertEquals(window?.url.searchParams.get("start"), "2026-08-15");
  assertEquals(window?.url.searchParams.get("start_after"), "cursor-20");
  assertEquals(result.windowStart, "2026-08-15");
});

const secondTreasuryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02";

Deno.test("a treasury resume continues the second account and keeps its start date", async () => {
  const firstTreasuryId = treasuryFile.accounts[0].id;
  const cursor = encodeMercuryResume({
    at: NOW.toISOString(),
    start: "2026-08-15",
    page: "7",
    phase: "treasury",
    treasuryId: secondTreasuryId,
  });
  const { fetchImpl, calls } = transport((url) => {
    if (url.pathname.includes("/treasury/") && url.pathname.endsWith("/transactions")) {
      return jsonResponse({ transactions: [{ id: "second-yield" }], cursor: null });
    }
    if (url.pathname.endsWith("/treasury")) {
      return jsonResponse({
        accounts: [...treasuryFile.accounts, { id: secondTreasuryId, status: "active" }],
        page: {},
      });
    }
    return jsonResponse({ transactions: [{ id: "bank-should-not-load" }], page: {} });
  });
  const result = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: fetchImpl,
    now: () => NOW,
  }), {
    cursor,
    importFrom: null,
    lookbackDays: 30,
  });
  assertEquals(result.lines.some((row) => (row as { id?: string }).id === "bank-should-not-load"), false);
  assertEquals(result.lines.some((row) => (row as { id?: string }).id === "second-yield"), true);
  assertEquals(result.windowStart, "2026-08-15");
  assertEquals(
    calls.some((call) => call.url.pathname === `/api/v1/treasury/${firstTreasuryId}/transactions`),
    false,
  );
  const ledger = calls.find((call) => call.url.pathname === `/api/v1/treasury/${secondTreasuryId}/transactions`);
  assertEquals(ledger?.url.searchParams.get("cursor"), "7");
  assertEquals(
    calls.some((call) => call.url.pathname.endsWith("/transactions") && !call.url.pathname.includes("/treasury/")),
    false,
  );
});

Deno.test("a treasury page cap keeps lines from the earlier treasury account", async () => {
  const firstTreasuryId = treasuryFile.accounts[0].id;
  let secondPages = 0;
  const { fetchImpl } = transport((url) => {
    if (url.pathname === `/api/v1/treasury/${firstTreasuryId}/transactions`) {
      return jsonResponse({ transactions: [{ id: "first-yield" }], cursor: null });
    }
    if (url.pathname === `/api/v1/treasury/${secondTreasuryId}/transactions`) {
      secondPages += 1;
      return jsonResponse({
        transactions: [{ id: `second-${secondPages}` }],
        cursor: `treasury-cursor-${secondPages}`,
      });
    }
    if (url.pathname.endsWith("/treasury")) {
      return jsonResponse({
        accounts: [...treasuryFile.accounts, { id: secondTreasuryId, status: "active" }],
        page: {},
      });
    }
    return jsonResponse({ transactions: [], page: {} });
  });
  const result = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, {
    fetch: fetchImpl,
    now: () => NOW,
  }), {
    cursor: null,
    importFrom: null,
    lookbackDays: 30,
  });
  assertEquals(secondPages, MERCURY_PAGE_CAP);
  assertEquals(result.complete, false);
  assertEquals(result.lines.some((row) => (row as { id?: string }).id === "first-yield"), true);
  assertEquals(result.lines.some((row) => (row as { id?: string }).id === "second-1"), true);
  const cursor = decodeMercuryCursor(result.nextCursor);
  assertEquals(cursor.phase, "treasury");
  assertEquals(cursor.treasuryId, secondTreasuryId);
  assertEquals(cursor.page, `treasury-cursor-${MERCURY_PAGE_CAP}`);
});

Deno.test("403 and 404 on the treasury ledger refuse the sync", async () => {
  for (const status of [403, 404] as const) {
    const { fetchImpl } = transport((url) => {
      if (url.pathname.includes("/treasury/") && url.pathname.endsWith("/transactions")) {
        return jsonResponse({ error: "no" }, status);
      }
      if (url.pathname.endsWith("/treasury")) return jsonResponse(treasuryFile);
      if (url.pathname.endsWith("/transactions")) {
        return jsonResponse({
          transactions: [{
            id: "liquidation-ledger",
            kind: "other",
            status: "sent",
            amount: 25000,
            createdAt: "2026-10-01T12:00:00.000Z",
            postedAt: "2026-10-01T12:00:00.000Z",
            bankDescription: "Liquidation of Treasury assets",
          }],
          page: {},
        });
      }
      return jsonResponse({ transactions: [], page: {} });
    });
    const error = await assertRejects(
      () => fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, {
        fetch: fetchImpl,
        now: () => NOW,
      }), { cursor: null, importFrom: null, lookbackDays: 30 }),
      MercuryRequestError,
    );
    assertEquals(error instanceof MercuryRequestError, true);
    if (!(error instanceof MercuryRequestError)) return;
    assertEquals(error.errorClass, status === 403 ? "auth" : "rejected");
    assertEquals(error.code, status === 403 ? "auth" : "rejected");
  }
});

Deno.test("a line dated exactly on import_from imports", async () => {
  const onDay = {
    ...page1.transactions[0],
    id: "on-import-from",
    createdAt: "2026-09-30T21:30:00.000Z",
  };
  const dayBefore = {
    ...page1.transactions[1],
    id: "day-before-import-from",
    createdAt: "2026-09-30T20:30:00.000Z",
  };
  assertEquals(jerusalemDate(onDay.createdAt), "2026-10-01");
  assertEquals(jerusalemDate(dayBefore.createdAt), "2026-09-30");
  const { fetchImpl } = bankTransport((url) => {
    if (url.searchParams.get("status") === "pending") return jsonResponse({ transactions: [], page: {} });
    if (!url.searchParams.get("start_after")) return jsonResponse({ transactions: [onDay, dayBefore], page: {} });
    return jsonResponse({ transactions: [], page: {} });
  });
  const result = await fetchMercurySince(openMercury(`test-${crypto.randomUUID()}`, { fetch: fetchImpl, now: () => NOW }), {
    cursor: null,
    importFrom: "2026-10-01",
    lookbackDays: 30,
  });
  const ids = result.lines.map((row) => (row as { id: string }).id);
  assertEquals(ids.includes("on-import-from"), true);
  assertEquals(ids.includes("day-before-import-from"), false);
});

Deno.test("a rate limit backs off until Retry-After, else 15 minutes, and at most a day", () => {
  const in15 = new Date(NOW.getTime() + 15 * 60 * 1000).toISOString();
  assertEquals(backoffUntil(null, NOW), in15);
  assertEquals(backoffUntil("not a date", NOW), in15);
  assertEquals(backoffUntil("2026-10-04T07:00:00.000Z", NOW), in15);
  assertEquals(backoffUntil("2026-10-04T09:00:00.000Z", NOW), "2026-10-04T09:00:00.000Z");
  assertEquals(backoffUntil("2026-10-09T08:00:00.000Z", NOW), "2026-10-05T08:00:00.000Z");
});

Deno.test("a reconnect to other accounts is a change; the same accounts in another order are not", () => {
  const next = [{ id: "acct-a", label: "Checking" }, { id: "acct-b", label: "Credit" }];
  assertEquals(mercuryAccountsChanged([{ id: "acct-b", label: "x" }, { id: "acct-a", label: "y" }], next), false);
  assertEquals(mercuryAccountsChanged([{ id: "acct-a", label: "Checking" }], next), true);
  assertEquals(mercuryAccountsChanged([{ id: "acct-a" }, { id: "acct-c" }], next), true);
  assertEquals(mercuryAccountsChanged([{ id: "acct-a" }, { id: "acct-b" }, { id: "acct-c" }], next), true);
  assertEquals(mercuryAccountsChanged(null, next), true);
  assertEquals(mercuryAccountsChanged([], []), false);
});

Deno.test("FLOW-707: card nicknames by last 4, only named cards, and an unreadable list is null", async () => {
  assertMercuryGet("GET", "/cards");
  const { fetchImpl, calls } = transport((url) => {
    if (url.pathname.endsWith("/cards")) {
      return jsonResponse({
        cards: [
          { id: "card-1", lastFour: "4242", nickname: "Example Street Utilities", nameOnCard: "Example Holder", kind: "credit" },
          { id: "card-2", lastFour: "1111", nickname: null, kind: "credit" },
          { id: "card-3", lastFour: "2222", nickname: "  ", kind: "debit" },
          { id: "card-4", lastFour: "3333", nickname: "Example General", kind: "credit" },
          { id: "card-5", lastFour: "3333", nickname: "Example Other", kind: "debit" },
          { id: "card-6", lastFour: "123", nickname: "Too short", kind: "debit" },
          { id: "card-7", lastFour: "4242", nickname: "Example Street Utilities", kind: "credit" },
        ],
        page: {},
      });
    }
    return jsonResponse({}, 404);
  });
  const session = openMercury(`test-${crypto.randomUUID()}`, { fetch: fetchImpl, now: () => NOW });
  assertEquals(await listMercuryCardLabels(session), [{ last4: "4242", label: "Example Street Utilities" }]);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].init.method, "GET");

  const denied = transport(() => jsonResponse({ errors: { message: "forbidden" } }, 403));
  const deniedSession = openMercury(`test-${crypto.randomUUID()}`, { fetch: denied.fetchImpl, now: () => NOW });
  assertEquals(await listMercuryCardLabels(deniedSession), null);
});
