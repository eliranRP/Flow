import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import page1 from "./fixtures/transactions-desc-page1.json" with { type: "json" };
import page2 from "./fixtures/transactions-desc-page2.json" with { type: "json" };
import failedFile from "./fixtures/transactions-status-failed.json" with { type: "json" };
import pendingFile from "./fixtures/transactions-status-pending.json" with { type: "json" };
import byId from "./fixtures/transaction-by-id.json" with { type: "json" };
import notFound from "./fixtures/transaction-not-found-404.json" with { type: "json" };
import syntheticPending from "./fixtures/SYNTHETIC-pending.json" with { type: "json" };
import syntheticSent from "./fixtures/SYNTHETIC-pending-then-sent.json" with { type: "json" };
import accountsFile from "./fixtures/accounts.json" with { type: "json" };
import creditFile from "./fixtures/credit.json" with { type: "json" };
import treasuryFile from "./fixtures/treasury.json" with { type: "json" };
import treasuryTxns from "./fixtures/SYNTHETIC-treasury-transactions.json" with { type: "json" };
import categoriesFile from "./fixtures/categories.json" with { type: "json" };
import snapshot from "./fixtures/canonical-snapshot.json" with { type: "json" };
import { MERCURY_SKIP_REASONS } from "../../../functions/_shared/connectors/mercury/capabilities.ts";
import { jerusalemDate } from "../../../functions/_shared/connectors/mercury/dates.ts";
import { dollarsToCents } from "../../../functions/_shared/connectors/mercury/money.ts";
import { classifyMercuryError, httpStatusVoids } from "../../../functions/_shared/connectors/mercury/client.ts";
import {
  MercuryCardAccountError,
  mercuryCardLast4,
  mercuryMemo,
  mercuryPaymentMethod,
  normalizeMercury,
  settlementPlan,
  treasuryVoidIds,
} from "../../../functions/_shared/connectors/mercury/normalize.ts";
import { postedSnapshot } from "./replay_fixture.ts";
import { redactMercury } from "../../../functions/_shared/connectors/mercury/redact.ts";
import { openConnector } from "../../../functions/_shared/connectors/registry.ts";
import { parseCanonicalLine, type CanonicalLine, type NormalizeContext } from "../../../functions/_shared/connectors/types.ts";

interface RawPage {
  transactions: RawTxn[];
  page?: { nextPage?: string };
}

interface RawTxn {
  id: string;
  status: string;
  kind: string;
  amount: number;
  createdAt: string;
  postedAt?: string | null;
  counterpartyName: string;
  accountId: string;
  [key: string]: unknown;
}

const postedPages = [page1, page2] as RawPage[];
const postedLines = postedPages.flatMap((page) => page.transactions);

function ownAccountIds(): string[] {
  return [
    ...accountsFile.accounts.map((account) => account.id),
    ...creditFile.accounts.map((account) => account.id),
    ...treasuryFile.accounts.map((account) => account.id),
  ];
}

function ctx(extra: Partial<NormalizeContext> = {}): NormalizeContext {
  return {
    ownAccountIds: ownAccountIds(),
    ownCounterpartyIds: [],
    vatRateBp: 1800,
    exemptSupplierNames: [],
    exemptSupplierIds: [],
    linkedDocuments: [],
    ...extra,
  };
}

function replay(rows: readonly unknown[], context = ctx()) {
  const imported: CanonicalLine[] = [];
  const skipped: Record<string, number> = {};
  const skippedRows: { external_id: string; reason: string }[] = [];
  for (const row of rows) {
    const result = normalizeMercury(row, context);
    if (!result.ok) {
      skipped[result.skip] = (skipped[result.skip] ?? 0) + 1;
      const id = row && typeof row === "object" && "id" in row && typeof row.id === "string" ? row.id : "";
      skippedRows.push({ external_id: id, reason: result.skip });
      continue;
    }
    imported.push(result.line);
  }
  skippedRows.sort((a, b) => a.external_id.localeCompare(b.external_id));
  return { imported, skipped, skippedRows };
}

const FORBIDDEN_SNAPSHOT = [
  "secret-token:",
  "accountNumber",
  "routingNumber",
  "dashboardLink",
  "Authorization",
  "https://",
  "http://",
  "@",
];

Deno.test("dollars become cents from the decimal string", () => {
  assertEquals(dollarsToCents(0.29), 29);
  assertEquals(dollarsToCents(1234.56), 123456);
  assertEquals(dollarsToCents(-318.41), -31841);
  assertEquals(dollarsToCents(JSON.parse("0.29")), 29);
  assertEquals(dollarsToCents(JSON.parse("1234.56")), 123456);
  assertEquals(dollarsToCents(JSON.parse("-318.41")), -31841);
  assertEquals(dollarsToCents(2650), 265000);
  assertEquals(dollarsToCents(1.005), null);
  assertEquals(dollarsToCents(Number.NaN), null);
  assertEquals(dollarsToCents(1e-7), null);
  assertEquals(dollarsToCents(1e21), null);
  assertEquals(dollarsToCents(1e2), 10000);
  assertEquals(dollarsToCents(-0), 0);
  assertEquals(Object.is(dollarsToCents(-0), -0), false);
  assertEquals(dollarsToCents("12.34"), null);
  assertEquals(dollarsToCents(""), null);
  assertEquals(dollarsToCents(null), null);
});

Deno.test("the posted fixture replay counts imports, skips, loans, cashback, and the refund", () => {
  const { imported, skipped } = replay(postedLines);
  assertEquals(postedLines.length, 100);
  assertEquals(imported.length, 70);
  assertEquals(imported.filter((line) => line.line_status === "pending").length, 0);
  assertEquals(skipped, {
    treasury_transfer: 6,
    internal_transfer: 4,
    own_account_transfer: 14,
    void_status: 6,
  });
  for (const reason of Object.keys(skipped)) {
    assertEquals(MERCURY_SKIP_REASONS.includes(reason as typeof MERCURY_SKIP_REASONS[number]), true);
  }

  const loans = imported.filter((line) => line.category_hint === "loan_part:principal");
  const cashback = imported.filter((line) => line.category_hint === "הכנסה אחרת");
  const refunds = imported.filter((line) => line.doc_kind === "credit");
  assertEquals(loans.length, 6);
  assertEquals(cashback.length, 7);
  assertEquals(refunds.length, 1);
  assertEquals(loans.every((line) => line.direction === "expense" && line.currency === "USD"), true);
  assertEquals(cashback.every((line) => line.direction === "income" && line.doc_kind === "invoice_receipt"), true);
  assertEquals(refunds[0].direction, "expense");
  assertEquals(refunds[0].amount_negated, false);
  assertEquals(refunds[0].vat, { amount: 0, status: "source" });
  assertEquals(refunds[0].amount_original, 600);
  assertEquals(refunds[0].counterparty.name, "Online Retailer");

  assertEquals(imported.some((line) => line.counterparty.name === "RentPortal" && line.direction === "income"), true);
  assertEquals(imported.some((line) => line.counterparty.name === "Metro Housing Authority"), true);
  assertEquals(imported.some((line) => line.counterparty.name === "Mercury Credit"), false);
  assertEquals(imported.some((line) => line.counterparty.name === "Treasury"), false);

  const differing = imported.filter((line) => line.doc_date !== line.cash_date);
  assertEquals(differing.length, 20);
  for (const line of imported) {
    assertEquals(parseCanonicalLine(line), line);
    assertEquals(line.currency, "USD");
    assertEquals(line.vat, { amount: 0, status: "source" });
    assertEquals(line.pnl_role, null);
  }
});

Deno.test("Jerusalem doc_date and cash_date can differ on a posted line", () => {
  let differ = 0;
  for (const row of postedLines) {
    if (row.status !== "sent" || !row.postedAt) continue;
    if (jerusalemDate(row.createdAt) !== jerusalemDate(row.postedAt)) differ += 1;
  }
  assertEquals(differ, 22);
});

Deno.test("the canonical snapshot has no token and no forbidden field", () => {
  const actual = postedSnapshot();
  assertEquals(JSON.stringify(actual), JSON.stringify(snapshot));
  const text = JSON.stringify(actual);
  for (const needle of FORBIDDEN_SNAPSHOT) {
    assertEquals(text.includes(needle), false, needle);
  }
  assertEquals(text.includes("secret-token:"), false);
});

Deno.test("a card refund, a loan prefix, and cashback keep their hints", () => {
  const { imported } = replay(postedLines);
  const loan = imported.find((line) => line.counterparty.name === "Lakeview Loan Servicing");
  assertEquals(loan?.category_hint, "loan_part:principal");
  assertEquals(dollarsToCents(-2000), -200000);
  assertEquals(loan?.amount_original, 200000);
  const servease = imported.filter((line) => line.counterparty.name === "Servease");
  assertEquals(servease.length, 2);
  assertEquals(servease.every((line) => line.category_hint === "loan_part:principal"), true);
  const cashback = imported.find((line) => line.counterparty.name === "Mercury IO Cashback" && line.amount_original === 3175);
  assertEquals(cashback?.category_hint, "הכנסה אחרת");
  assertEquals(cashback?.amount_negated, false);
});

Deno.test("treasury and internal skips follow the counterparty, not the kind alone", () => {
  const treasury = postedLines.filter((row) => row.kind === "treasuryTransfer");
  const internal = postedLines.filter((row) => row.kind === "internalTransfer");
  assertEquals(treasury.length, 6);
  assertEquals(internal.length, 4);
  const { imported, skipped } = replay(postedLines);
  assertEquals(imported.filter((line) => line.counterparty.name === "Treasury").length, 0);
  assertEquals(skipped.treasury_transfer, 6);
  assertEquals(skipped.internal_transfer, 4);
  assertEquals(treasury.every((row) => ownAccountIds().includes(String(row.counterpartyId))), true);
  assertEquals(internal.every((row) => ownAccountIds().includes(String(row.counterpartyId))), true);

  const base = postedLines.find((row) => row.kind === "outgoingPayment" && row.status === "sent");
  assertEquals(Boolean(base), true);
  if (!base) return;
  const own = ownAccountIds()[0];
  const treasuryId = treasuryFile.accounts[0].id;
  assertEquals(
    normalizeMercury({
      ...base,
      kind: "treasuryTransfer",
      amount: 25000,
      counterpartyId: treasuryId,
      counterpartyName: "Treasury",
    }, ctx()),
    { ok: false, skip: "treasury_transfer" },
  );
  assertEquals(
    normalizeMercury({
      ...base,
      kind: "treasuryTransfer",
      amount: -10000,
      counterpartyId: treasuryId,
      counterpartyName: "Treasury",
    }, ctx()),
    { ok: false, skip: "treasury_transfer" },
  );
  assertEquals(
    normalizeMercury({ ...base, kind: "internalTransfer", counterpartyId: own }, ctx()),
    { ok: false, skip: "internal_transfer" },
  );
  assertEquals(
    normalizeMercury({ ...base, kind: "treasuryTransfer", counterpartyId: own }, ctx()),
    { ok: false, skip: "treasury_transfer" },
  );
  const otherInternal = normalizeMercury({
    ...base,
    kind: "internalTransfer",
    counterpartyId: "not-an-own-account",
  }, ctx());
  assertEquals(otherInternal.ok, true);
  const otherTreasury = normalizeMercury({
    ...base,
    kind: "treasuryTransfer",
    amount: 100,
    counterpartyId: "not-an-own-account",
    counterpartyName: "Outside Treasury",
  }, ctx());
  assertEquals(otherTreasury.ok, true);
  if (!otherTreasury.ok) return;
  assertEquals(otherTreasury.line.direction, "income");
  assertEquals(otherTreasury.line.category_hint, null);
});

Deno.test("treasury yield and dividends import as other income", () => {
  const treasuryId = treasuryFile.accounts[0].id;
  for (const row of treasuryTxns.transactions) {
    const normalized = normalizeMercury(row, ctx());
    if (row.type === "interestPosted" || row.type === "dividendPosted") {
      assertEquals(normalized.ok, true);
      if (!normalized.ok) return;
      assertEquals(normalized.line.direction, "income");
      assertEquals(normalized.line.category_hint, "הכנסה אחרת");
      assertEquals(normalized.line.currency, "USD");
      assertEquals(normalized.line.doc_date, row.canonicalDay);
      assertEquals(normalized.line.provider_meta.kind, row.type);
      assertEquals(normalized.line.source_account_id, treasuryId);
    } else {
      assertEquals(normalized, { ok: false, skip: "treasury_activity" });
    }
  }
});

Deno.test("a Mercury deposit and treasury interest import as invoice_receipt (decision 0097)", () => {
  for (const kind of ["checkDeposit", "incomingDomesticWire"] as const) {
    const base = postedLines.find((row) => row.kind === kind && row.status === "sent" && row.amount > 0);
    assertEquals(Boolean(base), true, kind);
    if (!base) return;
    const deposit = normalizeMercury(base, ctx());
    assertEquals(deposit.ok, true, kind);
    if (!deposit.ok) return;
    assertEquals(deposit.line.direction, "income");
    assertEquals(deposit.line.doc_kind, "invoice_receipt");
  }

  const interestRow = treasuryTxns.transactions.find((row) => row.type === "interestPosted");
  assertEquals(Boolean(interestRow), true);
  if (!interestRow) return;
  const interest = normalizeMercury(interestRow, ctx());
  assertEquals(interest.ok, true);
  if (!interest.ok) return;
  assertEquals(interest.line.direction, "income");
  assertEquals(interest.line.doc_kind, "invoice_receipt");

  const outflow = postedLines.find((row) => row.kind === "outgoingPayment" && row.status === "sent");
  assertEquals(Boolean(outflow), true);
  if (!outflow) return;
  const expense = normalizeMercury(outflow, ctx());
  assertEquals(expense.ok && expense.line.doc_kind, "expense");
});

Deno.test("treasury fees, credits, cancels, and reinvestment follow the income rules", () => {
  const treasuryId = treasuryFile.accounts[0].id;
  const own = ctx();
  const fee = normalizeMercury({
    id: "44444444-4444-4444-8444-444444444444",
    accountId: treasuryId,
    type: "mercuryFeePosted",
    description: "Treasury fee",
    amount: -1.5,
    canonicalDay: "2026-09-02",
  }, own);
  assertEquals(fee.ok, true);
  if (!fee.ok) return;
  assertEquals(fee.line.direction, "expense");
  assertEquals(fee.line.amount_original, 150);
  assertEquals(fee.line.amount_negated, true);

  const credit = normalizeMercury({
    id: "55555555-5555-4555-8555-555555555555",
    accountId: treasuryId,
    type: "mercuryCreditPosted",
    description: "Mercury credit",
    amount: 2,
    canonicalDay: "2026-09-03",
  }, own);
  assertEquals(credit.ok, true);
  if (!credit.ok) return;
  assertEquals(credit.line.direction, "income");
  assertEquals(credit.line.category_hint, "הכנסה אחרת");
  assertEquals(credit.line.amount_original, 200);
  assertEquals(credit.line.amount_negated, false);

  const negativeInterest = normalizeMercury({
    id: "44444444-4444-4444-8444-444444444445",
    accountId: treasuryId,
    type: "interestPosted",
    description: "Interest reversal",
    amount: -3.21,
    canonicalDay: "2026-09-06",
  }, own);
  assertEquals(negativeInterest.ok, true);
  if (!negativeInterest.ok) return;
  assertEquals(negativeInterest.line.direction, "income");
  assertEquals(negativeInterest.line.amount_original, 321);
  assertEquals(negativeInterest.line.amount_negated, true);

  const negativeDividend = normalizeMercury({
    id: "44444444-4444-4444-8444-444444444446",
    accountId: treasuryId,
    type: "dividendPosted",
    description: "Dividend reversal",
    amount: -1,
    canonicalDay: "2026-09-07",
  }, own);
  assertEquals(negativeDividend.ok, true);
  if (!negativeDividend.ok) return;
  assertEquals(negativeDividend.line.amount_negated, true);

  const negativeCredit = normalizeMercury({
    id: "44444444-4444-4444-8444-444444444447",
    accountId: treasuryId,
    type: "mercuryCreditPosted",
    description: "Credit reversal",
    amount: -5,
    canonicalDay: "2026-09-08",
  }, own);
  assertEquals(negativeCredit.ok, true);
  if (!negativeCredit.ok) return;
  assertEquals(negativeCredit.line.direction, "income");
  assertEquals(negativeCredit.line.amount_negated, true);

  const amendment = normalizeMercury({
    id: "44444444-4444-4444-8444-444444444448",
    accountId: treasuryId,
    type: "manualAmendmentPosted",
    description: "Manual amendment",
    amount: 4,
    canonicalDay: "2026-09-09",
  }, own);
  assertEquals(amendment.ok, true);
  if (!amendment.ok) return;
  assertEquals(amendment.line.direction, "income");
  assertEquals(amendment.line.category_hint, "הכנסה אחרת");
  assertEquals(amendment.line.amount_negated, false);

  const revert = normalizeMercury({
    id: "44444444-4444-4444-8444-444444444449",
    accountId: treasuryId,
    type: "revertTxn",
    description: "Revert",
    amount: -4,
    canonicalDay: "2026-09-10",
  }, own);
  assertEquals(revert, { ok: false, skip: "treasury_activity" });

  const refund = normalizeMercury({
    id: "66666666-6666-4666-8666-666666666666",
    accountId: treasuryId,
    type: "mercuryFeeRefunded",
    description: "Fee refund",
    amount: 1.5,
    canonicalDay: "2026-09-04",
  }, own);
  assertEquals(refund.ok, true);
  if (!refund.ok) return;
  assertEquals(refund.line.direction, "income");

  const deposit = normalizeMercury({
    id: "77777777-7777-4777-8777-777777777777",
    accountId: treasuryId,
    type: "depositComplete",
    description: "Deposit into Treasury",
    amount: 25000,
    canonicalDay: "2026-09-05",
  }, own);
  assertEquals(deposit, { ok: false, skip: "treasury_activity" });

  const reinvest = normalizeMercury({
    id: "88888888-8888-4888-8888-888888888888",
    accountId: treasuryId,
    type: "dividendReinvestmentPosted",
    description: "Dividend reinvested",
    amount: 5,
    canonicalDay: "2026-09-15",
  }, own);
  assertEquals(reinvest, { ok: false, skip: "dividend_reinvestment" });

  const cancel = normalizeMercury({
    id: "99999999-9999-4999-8999-999999999999",
    accountId: treasuryId,
    type: "interestCanceled",
    description: "Interest canceled",
    amount: -12.34,
    canonicalDay: "2026-09-30",
    cancelsTransactionId: "11111111-1111-4111-8111-111111111111",
  }, own);
  assertEquals(cancel, { ok: false, skip: "treasury_cancel" });

  const dividend = treasuryTxns.transactions[1];
  const voids = treasuryVoidIds([
    dividend,
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      accountId: treasuryId,
      type: "dividendReinvestmentPosted",
      amount: 5,
      canonicalDay: "2026-09-15",
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      accountId: treasuryId,
      type: "interestCanceled",
      amount: -12.34,
      canonicalDay: "2026-09-30",
    },
  ], [{
    externalId: "11111111-1111-4111-8111-111111111111",
    kind: "interestPosted",
    amountCents: 1234,
    accountId: treasuryId,
    docDate: "2026-09-30",
  }]);
  assertEquals(voids, ["11111111-1111-4111-8111-111111111111"]);
  const outsideTreasury = normalizeMercury({
    id: "44444444-4444-4444-8444-444444444450",
    accountId: "not-our-treasury",
    type: "interestPosted",
    description: "Outside yield",
    amount: 1.25,
    canonicalDay: "2026-09-11",
  }, own);
  assertEquals(outsideTreasury, { ok: false, skip: "not_own_account" });

  const imported = [dividend, {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountId: treasuryId,
    type: "dividendReinvestmentPosted",
    amount: 5,
    canonicalDay: "2026-09-15",
  }].map((row) => normalizeMercury(row, own)).filter((row) => row.ok);
  assertEquals(imported.length, 1);
});

Deno.test("the fourteen autopay skips are paired payments between own checking and own credit", () => {
  const { skippedRows } = replay(postedLines);
  const autopay = skippedRows.filter((row) => row.reason === "own_account_transfer");
  assertEquals(autopay.length, 14);
  const byId = new Map(postedLines.map((row) => [row.id, row]));
  for (const row of autopay) {
    const raw = byId.get(row.external_id);
    assertEquals(Boolean(raw), true);
    if (!raw) return;
    assertEquals(raw.kind, "other");
    assertEquals(raw.status, "sent");
    const description = String(raw.bankDescription);
    assertEquals(/IO AUTOPAY|IO PAYMENT/.test(description), true);
    const name = String(raw.counterpartyName);
    assertEquals(name === "Mercury Credit" || name.startsWith("Mercury Checking"), true);
    const upper = name.toUpperCase();
    assertEquals(upper.startsWith("NEWREZ") || upper.startsWith("LAKEVIEW LOAN") || upper.startsWith("SERVEASE"), false);
  }
});

/** Same tokens as a fixture gram: lowercase, NFKD, diacritics stripped, split on non-letters and digits. */
export function fixtureTokens(text: string): string[] {
  const stripped = text.normalize("NFKD").replace(/\p{M}+/gu, "");
  return stripped.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 0);
}

export function normalisedDenyEntry(line: string): string | null {
  const words = fixtureTokens(line);
  if (words.length === 0) return null;
  return words.join(" ");
}

function denyNamesFromEnv(raw: string | undefined): Set<string> {
  const names = new Set<string>();
  if (!raw) return names;
  for (const line of raw.split(/\r?\n/)) {
    const name = normalisedDenyEntry(line);
    if (name) names.add(name);
  }
  return names;
}

/** Fork pull requests run in eliranRP/Flow but GitHub does not pass Actions secrets. */
export function fixtureDenyListRequired(env: { get(name: string): string | undefined }): boolean {
  if (env.get("GITHUB_ACTIONS") !== "true") return false;
  if ((env.get("GITHUB_REPOSITORY") ?? "").toLowerCase() !== "eliranrp/flow") return false;
  return env.get("GITHUB_EVENT_HEAD_REPO_FORK") !== "true";
}

function wordGrams(text: string): Set<string> {
  const words = fixtureTokens(text);
  const grams = new Set<string>();
  const widest = Math.min(6, words.length);
  for (let size = 1; size <= widest; size += 1) {
    for (let index = 0; index + size <= words.length; index += 1) {
      grams.add(words.slice(index, index + size).join(" "));
    }
  }
  return grams;
}

const fixtureDenyNames = denyNamesFromEnv(Deno.env.get("MERCURY_FIXTURE_DENYLIST"));
const denyListIsRequired = fixtureDenyListRequired(Deno.env);
if (fixtureDenyNames.size === 0 && !denyListIsRequired) {
  console.log("skipping fixture deny-list: MERCURY_FIXTURE_DENYLIST is not set");
}

Deno.test("a fork of this repo skips the deny-list when the secret is absent", () => {
  const env = (values: Record<string, string | undefined>) => ({
    get(name: string) {
      return values[name];
    },
  });
  assertEquals(fixtureDenyListRequired(env({})), false);
  assertEquals(fixtureDenyListRequired(env({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "someone/Flow",
  })), false);
  assertEquals(fixtureDenyListRequired(env({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "eliranRP/Flow",
    GITHUB_EVENT_HEAD_REPO_FORK: "true",
  })), false);
  assertEquals(fixtureDenyListRequired(env({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "eliranRP/Flow",
  })), true);
  assertEquals(fixtureDenyListRequired(env({
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "eliranRP/Flow",
    GITHUB_EVENT_HEAD_REPO_FORK: "false",
  })), true);
  assertEquals(fixtureTokens("José  García"), ["jose", "garcia"]);
  assertEquals(normalisedDenyEntry("  José   García "), "jose garcia");
  const grams = wordGrams("one two three four five six seven");
  assertEquals(grams.has("one two three four five six"), true);
  assertEquals(grams.has("one two three four five six seven"), false);
});

function hasDeniedGram(text: string): boolean {
  for (const gram of wordGrams(text)) {
    if (fixtureDenyNames.has(gram)) return true;
  }
  return false;
}

/**
 * The deny-list is the MERCURY_FIXTURE_DENYLIST Actions secret: one name per line, at most six words each.
 * It lists the real names and codes the recorded fixtures once held, so they never come back.
 * The Mercury test sources are scanned too, since their assertions name fixture counterparties.
 * scripts/check-deny-list.mjs scans the whole repo against the same secret at any entry length;
 * this narrower check stays so `pnpm test:connectors` alone still covers the fixtures.
 */
Deno.test({
  name: "fixtures and Mercury tests contain none of the denied names",
  ignore: fixtureDenyNames.size === 0 && !denyListIsRequired,
  fn() {
    if (fixtureDenyNames.size === 0) {
      throw new Error("MERCURY_FIXTURE_DENYLIST is required in CI on eliranRP/Flow");
    }
    const dir = new URL("./fixtures/", import.meta.url);
    let files = 0;
    for (const entry of Deno.readDirSync(dir)) {
      if (!entry.isFile) continue;
      files += 1;
      assertEquals(hasDeniedGram(Deno.readTextFileSync(new URL(entry.name, dir))), false, entry.name);
    }
    assertEquals(files >= 12, true);
    const testDir = new URL("./", import.meta.url);
    let sources = 0;
    for (const entry of Deno.readDirSync(testDir)) {
      if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
      sources += 1;
      assertEquals(hasDeniedGram(Deno.readTextFileSync(new URL(entry.name, testDir))), false, entry.name);
    }
    assertEquals(sources >= 3, true);
  },
});

Deno.test("fixtures keep no counterparty nickname", () => {
  const dir = new URL("./fixtures/", import.meta.url);
  for (const entry of Deno.readDirSync(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const text = Deno.readTextFileSync(new URL(entry.name, dir));
    assertEquals(text.includes("\"counterpartyNickname\": \""), false, entry.name);
  }
});

Deno.test("a Jerusalem instant is not the UTC date, and providerCategory is kept", () => {
  const base = postedLines.find((row) => row.kind === "outgoingPayment" && row.status === "sent");
  assertEquals(Boolean(base), true);
  if (!base) return;
  const line = normalizeMercury({
    ...base,
    createdAt: "2026-10-03T21:30:00Z",
    postedAt: "2026-10-03T21:30:00Z",
    mercuryCategory: "Software",
  }, ctx());
  assertEquals(line.ok, true);
  if (!line.ok) return;
  assertEquals(line.line.doc_date, "2026-10-04");
  assertEquals(line.line.cash_date, "2026-10-04");
  assertEquals(jerusalemDate("2026-10-03T21:30:00Z"), "2026-10-04");
  assertEquals(line.line.provider_meta.kind, "outgoingPayment");
  assertEquals(line.line.provider_meta.providerCategory, "Software");
});

Deno.test("FLOW-304: the method, the card's last 4, the memo and the account are kept, and nothing else", () => {
  const card = postedLines.find((row) => row.kind === "creditCardTransaction" && row.status === "sent");
  const ach = postedLines.find((row) => row.kind === "outgoingPayment" && row.status === "sent");
  assertEquals(Boolean(card && ach), true);
  if (!card || !ach) return;
  const cardLine = normalizeMercury({
    ...card,
    details: { creditCardInfo: { id: "card-1", email: "name@example.com", paymentMethod: "Credit Card ••4242" } },
    externalMemo: "Order 123456789 for unit 2",
  }, ctx());
  assertEquals(cardLine.ok, true);
  if (!cardLine.ok) return;
  assertEquals(cardLine.line.provider_meta.method, "card");
  assertEquals(cardLine.line.provider_meta.card_last4, "4242");
  assertEquals(cardLine.line.provider_meta.memo, "Order **** for unit 2");
  assertEquals(cardLine.line.provider_meta.account_id, card.accountId);
  const text = JSON.stringify(cardLine.line.provider_meta);
  for (const needle of ["name@example.com", "card-1", "123456789"]) assertEquals(text.includes(needle), false, needle);

  const achLine = normalizeMercury({
    ...ach,
    details: { electronicRoutingInfo: { accountNumber: "000123456789", routingNumber: "000000000", bankName: "EXAMPLE BANK" } },
    note: "Rent for unit 1",
  }, ctx());
  assertEquals(achLine.ok, true);
  if (!achLine.ok) return;
  assertEquals(achLine.line.provider_meta.method, "ach");
  assertEquals(achLine.line.provider_meta.card_last4, undefined);
  assertEquals(achLine.line.provider_meta.memo, "Rent for unit 1");
  assertEquals(JSON.stringify(achLine.line).includes("000123456789"), false);
  assertEquals(JSON.stringify(achLine.line).includes("EXAMPLE BANK"), false);
});

Deno.test("FLOW-304: the payment method follows the kind and the routing block", () => {
  assertEquals(mercuryPaymentMethod("debitCardTransaction", {}), "card");
  assertEquals(mercuryPaymentMethod("cardInternationalTransactionFee", {}), "card");
  assertEquals(mercuryPaymentMethod("incomingDomesticWire", {}), "wire");
  assertEquals(mercuryPaymentMethod("outgoingPayment", { details: { domesticWireRoutingInfo: {} } }), "wire");
  assertEquals(mercuryPaymentMethod("outgoingPayment", { details: { electronicRoutingInfo: {} } }), "ach");
  assertEquals(mercuryPaymentMethod("outgoingPayment", { checkNumber: "1001" }), "check");
  assertEquals(mercuryPaymentMethod("checkDeposit", {}), "check");
  assertEquals(mercuryPaymentMethod("internalTransfer", {}), "transfer");
  assertEquals(mercuryPaymentMethod("other", {}), "other");
  assertEquals(mercuryCardLast4({ details: { debitCardInfo: { paymentMethod: "Debit Card ••1234" } } }), "1234");
  assertEquals(mercuryCardLast4({ details: { creditCardInfo: { paymentMethod: "Credit Card 4242424242424242" } } }), null);
  assertEquals(mercuryCardLast4({ details: {} }), null);
  assertEquals(mercuryMemo({ externalMemo: "   " }), null);
  assertEquals(mercuryMemo({ externalMemo: "x".repeat(500) })?.length, 200);
});

Deno.test("a non-USD line is refused and a bad amount is not not_a_line", () => {
  const base = postedLines.find((row) => row.kind === "outgoingPayment" && row.status === "sent");
  assertEquals(Boolean(base), true);
  if (!base) return;
  assertEquals(normalizeMercury({ ...base, currency: "EUR" }, ctx()), { ok: false, skip: "non_usd" });
  assertEquals(
    normalizeMercury({ ...base, currencyExchangeInfo: { convertedToCurrency: "EUR" } }, ctx()),
    { ok: false, skip: "non_usd" },
  );
  const merchant = normalizeMercury({ ...base, merchant: { currency: "ILS", amount: 100 } }, ctx());
  assertEquals(merchant.ok, true);
  if (!merchant.ok) return;
  assertEquals(merchant.line.currency, "USD");
  assertEquals(normalizeMercury({ ...base, amount: "12.34" }, ctx()), { ok: false, skip: "refused_amount" });
  assertEquals(normalizeMercury({ ...base, amount: 1e-7 }, ctx()), { ok: false, skip: "refused_amount" });
  assertEquals(normalizeMercury({ ...base, amount: null }, ctx()), { ok: false, skip: "refused_amount" });
  assertEquals(normalizeMercury({ ...base, amount: 0 }, ctx()), { ok: false, skip: "not_a_line" });
});

Deno.test("card spend throws when its account is missing from the connected set", () => {
  const card = postedLines.find((row) => row.kind === "creditCardTransaction");
  assertEquals(Boolean(card), true);
  if (!card) return;
  assertEquals(card.accountId, creditFile.accounts[0].id);
  assertEquals(ownAccountIds().includes(creditFile.accounts[0].id), true);
  const cardKinds = postedLines.filter((row) =>
    row.kind.startsWith("creditCard") || row.kind.startsWith("debitCard") || row.kind.startsWith("cardInternational")
  );
  assertEquals(cardKinds.length > 0, true);
  for (const row of cardKinds) {
    assertEquals(ownAccountIds().includes(row.accountId), true, row.id);
  }
  const withoutCredit = ownAccountIds().filter((id) => id !== creditFile.accounts[0].id);
  const error = assertThrows(
    () => normalizeMercury(card, ctx({ ownAccountIds: withoutCredit })),
    MercuryCardAccountError,
  );
  assertEquals(classifyMercuryError(error), { class: "rejected", retry_after: null });
});

Deno.test("a fee rebate and a fee reversal stay expense credits", () => {
  const base = postedLines.find((row) => row.kind === "creditCardCredit" && row.status === "sent");
  assertEquals(Boolean(base), true);
  if (!base) return;
  for (const kind of ["cardInternationalTransactionFeeRebate", "cardInternationalTransactionFeeReversal"] as const) {
    const line = normalizeMercury({ ...base, kind, amount: 1.25, counterpartyName: "Intl Fee" }, ctx());
    assertEquals(line.ok, true, kind);
    if (!line.ok) return;
    assertEquals(line.line.direction, "expense");
    assertEquals(line.line.doc_kind, "credit");
    assertEquals(line.line.amount_negated, false);
    assertEquals(line.line.amount_original, 125);
  }
  const rebateReversal = normalizeMercury({
    ...base,
    kind: "cardInternationalTransactionFeeRebateReversal",
    amount: -1.25,
  }, ctx());
  assertEquals(rebateReversal.ok, true);
  if (!rebateReversal.ok) return;
  assertEquals(rebateReversal.line.direction, "expense");
  assertEquals(rebateReversal.line.doc_kind, "expense");
});

Deno.test("synthetic pending posts onto the same id and keeps the assignment", () => {
  const pendingRaw = (syntheticPending as RawPage).transactions[0];
  const sentRaw = (syntheticSent as RawPage).transactions[0];
  const pending = normalizeMercury(pendingRaw, ctx());
  const sent = normalizeMercury(sentRaw, ctx());
  assertEquals(pending.ok, true);
  assertEquals(sent.ok, true);
  if (!pending.ok || !sent.ok) return;
  assertEquals(pending.line.line_status, "pending");
  assertEquals(pending.line.cash_date, null);
  assertEquals(pending.line.external_id, sent.line.external_id);
  assertEquals(sent.line.line_status, "posted");
  assertEquals(sent.line.doc_date === sent.line.cash_date, false);
  assertEquals(pending.line.amount_original, 3200);
  const assignment = new Map([[pending.line.external_id, "user-category"]]);
  assertEquals(settlementPlan(pending.line.external_id, sent.line.external_id), { action: "update" });
  assertEquals(assignment.get(sent.line.external_id), "user-category");
});

Deno.test("a changed Mercury id voids the stored pending line and inserts the new one", () => {
  const pendingRaw = (syntheticPending as RawPage).transactions[0];
  const sentRaw = (syntheticSent as RawPage).transactions[0];
  const pending = normalizeMercury(pendingRaw, ctx());
  const sent = normalizeMercury({ ...sentRaw, id: "posted-other-id" }, ctx());
  assertEquals(pending.ok && sent.ok, true);
  if (!pending.ok || !sent.ok) return;
  assertEquals(settlementPlan(pending.line.external_id, sent.line.external_id), {
    action: "void_and_reinsert",
    voidId: pending.line.external_id,
  });
});

Deno.test("a 404 lookup voids, and a first-seen failed line is skipped", () => {
  assertEquals(notFound.status, 404);
  assertEquals(httpStatusVoids(notFound.status), true);
  assertEquals(httpStatusVoids(200), false);
  const failed = replay(failedFile.transactions);
  assertEquals(failed.imported.length, 0);
  assertEquals(failed.skipped, { void_status: failedFile.transactions.length });
  assertEquals(pendingFile.transactions.length, 0);
});

Deno.test("an unknown status is rejected, and a transfer outside the connected set is hinted העברות", () => {
  const base = postedLines.find((row) => row.kind === "outgoingPayment" && row.status === "sent");
  assertEquals(Boolean(base), true);
  if (!base) return;
  const unknown = normalizeMercury({ ...base, status: "settled" }, ctx());
  assertEquals(unknown, { ok: false, skip: "unknown_status" });
  const outside = normalizeMercury(
    { ...base, kind: "other", accountId: "not-our-account", counterpartyId: "someone-else" },
    ctx(),
  );
  assertEquals(outside, { ok: false, skip: "not_own_account" });
  const transfer = normalizeMercury(
    { ...base, kind: "externalTransfer", counterpartyId: "external-own-1" },
    ctx({ ownCounterpartyIds: ["external-own-1"] }),
  );
  assertEquals(transfer.ok, true);
  if (!transfer.ok) return;
  assertEquals(transfer.line.category_hint, "העברות");
});

Deno.test("a bare transaction and a redacted description stay inside the schema", () => {
  const line = normalizeMercury(byId, ctx());
  assertEquals(line.ok, true);
  if (!line.ok) return;
  assertEquals(line.line.line_status, "posted");
  assertEquals(parseCanonicalLine(line.line).source, "mercury");
  const dirty = normalizeMercury({
    ...postedLines[0],
    bankDescription: "wire 123456789 secret-token:should-not-survive",
  }, ctx());
  assertEquals(dirty.ok, true);
  if (!dirty.ok) return;
  assertEquals(dirty.line.description.includes("123456789"), false);
  assertEquals(dirty.line.description.includes("should-not-survive"), false);
  assertEquals(dirty.line.description.includes("secret-token:[redacted]"), true);
  const cleaned = redactMercury({
    Authorization: "Bearer secret-token:abc123",
    message: "failed secret-token:abc123",
  });
  const text = JSON.stringify(cleaned);
  assertEquals(text.includes("abc123"), false);
  assertEquals(text.includes("secret-token:abc"), false);
});

Deno.test("the committed fixtures contain no token and no routing number", () => {
  const text = JSON.stringify({
    page1,
    page2,
    failedFile,
    pendingFile,
    byId,
    notFound,
    syntheticPending,
    syntheticSent,
    accountsFile,
    creditFile,
    categoriesFile,
  });
  assertEquals(text.includes("secret-token:"), false);
  assertEquals(text.includes("accountNumber"), false);
  assertEquals(text.includes("routingNumber"), false);
  assertEquals(text.includes("Authorization"), false);
});

Deno.test("openConnector does not put the secret on the session", () => {
  const secret = `test-${crypto.randomUUID()}`;
  const session = openConnector("mercury", secret);
  assertEquals(session.provider, "mercury");
  assertEquals(JSON.stringify(session).includes(secret), false);
  let unavailable = false;
  try {
    openConnector("sumit", secret);
  } catch (error) {
    unavailable = error instanceof Error && error.message === "connector_unavailable";
  }
  assertEquals(unavailable, true);
});
