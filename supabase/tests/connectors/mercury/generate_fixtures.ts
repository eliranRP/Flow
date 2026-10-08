/**
 * Builds every file in ./fixtures from one seed (FLOW-903). Nothing here comes from a real
 * account: ids, times, amounts and balances are drawn from a seeded generator, and names are
 * labels. Each value is drawn from its own key, so adding a row does not move the others.
 *
 * Rebuild the fixtures:   pnpm fixtures:mercury
 * fixtures_test.ts checks the committed files match buildFixtures() byte for byte.
 */
import { snapshotOf } from "./snapshot.ts";

export const SEED = "flow-mercury-fixtures-1";

const LINK = "https://example.invalid/redacted";
const EMAIL = "name@example.com";
const BUSINESS = "Example Holdings LLC";
const SEND_MONEY = "Send Money transaction initiated on Mercury";
const CHECKING_LABEL = "Mercury Checking ••0000";
const DAY_MS = 86_400_000;

// ---- Seeded randomness: cyrb128 hashes SEED and a key into the state of an sfc32 stream.

function cyrb128(text: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

class Rand {
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(key: string) {
    [this.#a, this.#b, this.#c, this.#d] = cyrb128(`${SEED}:${key}`);
  }

  /** sfc32: a float in [0, 1). */
  next(): number {
    this.#a |= 0;
    this.#b |= 0;
    this.#c |= 0;
    this.#d |= 0;
    const t = (((this.#a + this.#b) | 0) + this.#d) | 0;
    this.#d = (this.#d + 1) | 0;
    this.#a = this.#b ^ (this.#b >>> 9);
    this.#b = (this.#c + (this.#c << 3)) | 0;
    this.#c = (this.#c << 21) | (this.#c >>> 11);
    this.#c = (this.#c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** An integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  /** Dollars in [lo, hi] on a step of `stepCents`, as a number with at most two decimals. */
  dollars(lo: number, hi: number, stepCents: number): number {
    const steps = Math.round(((hi - lo) * 100) / stepCents);
    return (Math.round(lo * 100) + this.int(0, steps) * stepCents) / 100;
  }
}

const rand = (key: string) => new Rand(key);

function uuid(key: string): string {
  const r = rand(`uuid:${key}`);
  const bytes = Array.from({ length: 16 }, () => r.int(0, 255));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hex(key: string, length: number): string {
  const r = rand(`hex:${key}`);
  return Array.from({ length }, () => r.int(0, 15).toString(16)).join("");
}

/** An ISO time with microseconds, as Mercury writes it. */
function iso(ms: number, key: string): string {
  // Mercury drops trailing zeros from the fraction, so some times have fewer than six digits.
  const micros = String(rand(`micros:${key}`).int(0, 999_999)).padStart(6, "0").replace(/0+$/, "");
  return `${new Date(ms).toISOString().slice(0, 19)}${micros ? `.${micros}` : ""}Z`;
}

/** A whole second inside [fromHour, toHour) UTC on the day. */
function at(day: string, r: Rand, fromHour: number, toHour: number): number {
  return Date.parse(`${day}T00:00:00Z`) + r.int(fromHour * 3600, toHour * 3600 - 1) * 1000;
}

/** Mercury's delivery estimate: a later day at local midnight (21:00 UTC in summer, 22:00 in winter). */
function eta(ms: number, days: number, hourUtc = 21): string {
  const day = new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
  return `${day}T${String(hourUtc).padStart(2, "0")}:00:00Z`;
}

const cents = (dollars: number) => Math.round(dollars * 100);

// ---- Accounts and categories.

const CATEGORY_NAMES = [
  "Revenue", "Shipping & Postage", "Interest Earned", "COGS", "Financing Proceeds",
  "Legal & Professional Services", "Software & Subscriptions", "Rent & Utilities", "Bank Fees",
  "Credit & Loan Payments", "Business Meals", "Entertainment", "Office Supplies & Equipment",
  "Travel & Transportation", "Employee Benefits", "Marketing & Advertising", "Transfer", "Insurance",
  "Inventory & Materials", "Payment Processing Fees", "Payroll", "Taxes", "Other Costs",
];

/** Other Costs is a card-spend-only category, as Mercury ships it. */
function category(name: string) {
  if (!CATEGORY_NAMES.includes(name)) throw new Error(`unknown category ${name}`);
  const cardOnly = name === "Other Costs";
  return {
    id: uuid(`category:${name}`),
    name,
    visibleForReimbursements: !cardOnly,
    visibleForCardSpend: true,
    visibleForOther: !cardOnly,
  };
}

/** Account 2 is savings; the rest are checking. Accounts 3 and up carry an empty nickname. */
const ACCOUNT_COUNT = 9;
const accountId = (n: number) => uuid(`account:${n}`);
const CREDIT = uuid("account:credit");
const TREASURY = uuid("account:treasury");
const CHECKING = accountId(1);

function accountsFile() {
  const accounts = [];
  for (let n = 1; n <= ACCOUNT_COUNT; n++) {
    const r = rand(`account:${n}`);
    const savings = n === 2;
    const opened = Date.parse("2024-12-01T00:00:00Z") + r.int(0, 540) * DAY_MS + r.int(0, 86_399) * 1000;
    const balance = n === 1 ? r.dollars(15000, 30000, 5000) : savings || n === ACCOUNT_COUNT ? 0 : r.dollars(100, 6000, 500);
    accounts.push({
      id: accountId(n),
      name: `Mercury ${savings ? "Savings" : "Checking"} ••0000 (${n})`,
      status: "active",
      type: "mercury",
      createdAt: iso(opened, `account:${n}`),
      availableBalance: balance,
      currentBalance: balance,
      kind: savings ? "savings" : "checking",
      canSendRealTimePayments: false,
      ...(n >= 3 ? { nickname: null } : {}),
      legalBusinessName: BUSINESS,
      dashboardLink: LINK,
    });
  }
  return { accounts, page: {} };
}

function creditFile() {
  const r = rand("account:credit");
  const balance = -r.dollars(50, 400, 500);
  return {
    accounts: [{
      id: CREDIT,
      status: "active",
      createdAt: iso(Date.parse("2025-12-01T00:00:00Z") + r.int(0, 40) * DAY_MS + r.int(0, 86_399) * 1000, "account:credit"),
      availableBalance: balance,
      currentBalance: balance,
    }],
  };
}

const treasuryFile = () => ({ accounts: [{ id: TREASURY, status: "active" }], page: {} });

// ---- One transaction row, every field in Mercury's order.

interface Row {
  key: string;
  kind: string;
  status?: string;
  amount: number;
  created: number;
  posted: number | null;
  eta: string;
  desc: string | null;
  name: string;
  cp?: string;
  account?: string;
  card?: { key: string; credit: boolean };
  ach?: [string, string];
  wireBank?: string;
  period?: string;
  categoryName?: string;
  gl?: string;
  merchant?: { mcc: string; category?: string; currency?: string };
  attachments?: string[];
  receipt?: boolean;
  check?: boolean;
  request?: boolean;
  failed?: { at: number; reason: string };
  related?: { kind: string; amount: number };
  synthetic?: string;
}

function txn(row: Row) {
  const card = row.card ? uuid(`card:${row.card.key}`) : null;
  const details: Record<string, unknown> = {};
  if (row.ach) details.electronicRoutingInfo = { bankName: row.ach[0], electronicAccountType: row.ach[1] };
  if (row.wireBank) details.domesticWireRoutingInfo = { bankName: row.wireBank };
  if (row.card?.credit) details.creditCardInfo = { id: card, email: EMAIL, paymentMethod: "Credit Card ••0000" };
  if (row.card && !row.card.credit) details.debitCardInfo = { id: card };
  const out: Record<string, unknown> = {
    id: uuid(`txn:${row.key}`),
    feeId: null,
    amount: row.amount,
    createdAt: iso(row.created, `created:${row.key}`),
    postedAt: row.posted === null ? null : iso(row.posted, `posted:${row.key}`),
    estimatedDeliveryDate: row.eta,
    status: row.status ?? "sent",
    note: null,
    bankDescription: row.desc,
    externalMemo: null,
    counterpartyId: row.cp ?? uuid(`counterparty:${row.name}`),
    details,
    cardId: card,
    reasonForFailure: row.failed?.reason ?? null,
    failedAt: row.failed ? iso(row.failed.at, `failed:${row.key}`) : null,
    dashboardLink: LINK,
    counterpartyName: row.name,
    counterpartyNickname: null,
    kind: row.kind,
    currencyExchangeInfo: null,
    compliantWithReceiptPolicy: true,
    hasGeneratedReceipt: row.receipt ?? false,
    creditAccountPeriodId: row.period ? uuid(`period:${row.period}`) : null,
    mercuryCategory: row.merchant?.category ?? null,
    generalLedgerCodeName: null,
    glAllocations: row.gl ? [{ glCodeName: row.gl, amount: row.amount }] : [],
    attachments: (row.attachments ?? []).map((attachmentType) => ({ fileName: "receipt.pdf", url: LINK, attachmentType })),
    relatedTransactions: row.related
      ? [{ id: uuid(`related:${row.key}`), accountId: row.account ?? CHECKING, relationKind: row.related.kind, amount: row.related.amount }]
      : [],
    categoryData: row.categoryName ? category(row.categoryName) : null,
    checkNumber: row.check ? "0000" : null,
    trackingNumber: null,
    requestId: row.request ? uuid(`request:${row.key}`) : null,
    accountId: row.account ?? CHECKING,
    merchant: row.merchant
      ? {
        categoryCode: row.merchant.mcc,
        id: `m_${hex(`merchant:${row.key}`, 13)}`,
        ...(row.merchant.category ? { category: row.merchant.category } : {}),
        amount: cents(row.amount),
        currency: row.merchant.currency ?? "USD",
      }
      : null,
  };
  if (row.synthetic) out._synthetic = row.synthetic;
  return out;
}

/** The card statement period a card line falls in: one per calendar month. */
const periodOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

// ---- The posted window, 2026-06-10..2026-07-31: 100 lines covering every edge case.

/** Three legs of a card payment: checking pays the card (two own-account legs) and cashback lands. */
function autopay(day: string, n: number, words: string): Row[] {
  const r = rand(`autopay:${n}`);
  const created = at(day, r, 0, 20);
  const amount = r.dollars(50, 3500, r.int(0, 1) ? 2500 : 25);
  const settle = eta(created, r.int(4, 7));
  const tag = n <= 3 ? "Credit & Loan Payments" : undefined;
  const legTime = () => created + r.int(-40, 40) * 1000;
  return [
    {
      key: `autopay-${n}-cashback`, kind: "other", amount: r.dollars(1, 60, 25), created: legTime(), posted: legTime(),
      eta: settle, desc: null, name: "Mercury IO Cashback", gl: n > 3 ? "Credit card rewards" : undefined,
    },
    {
      key: `autopay-${n}-card`, kind: "other", amount, created: legTime(), posted: legTime(), eta: settle, desc: words,
      name: CHECKING_LABEL, cp: CHECKING, account: CREDIT, categoryName: tag, period: periodOf(created),
    },
    {
      key: `autopay-${n}-checking`, kind: "other", amount: -amount, created: legTime(), posted: legTime(), eta: settle,
      desc: words, name: "Mercury Credit", cp: CREDIT, categoryName: tag,
    },
  ];
}

/** Treasury sells assets into checking: one leg on each account. */
function liquidation(day: string, n: number, settleDays: number): Row[] {
  const r = rand(`treasury:${n}`);
  const created = at(day, r, 5, 19);
  const posted = created + settleDays * DAY_MS + r.int(600, 3600) * 1000;
  const amount = r.dollars(5000, 20000, 5000);
  const settle = eta(posted, 0);
  const desc = "Liquidation of Treasury assets";
  return [
    {
      key: `treasury-${n}-out`, kind: "treasuryTransfer", amount: -amount, created, posted, eta: settle, desc,
      name: CHECKING_LABEL, cp: CHECKING, account: TREASURY, categoryName: n === 1 ? "Credit & Loan Payments" : undefined,
    },
    {
      key: `treasury-${n}-in`, kind: "treasuryTransfer", amount, created: created + r.int(0, 30) * 1000,
      posted: posted + r.int(1, 60) * 1000, eta: settle, desc, name: "Treasury", cp: TREASURY,
      categoryName: n === 1 ? "Transfer" : undefined,
    },
  ];
}

/** A move from main checking to another own checking account. */
function internal(day: string, n: number, other: number): Row[] {
  const r = rand(`internal:${n}`);
  const created = at(day, r, 4, 8);
  const amount = r.dollars(100, 600, 500);
  const settle = eta(created, 7);
  const desc = "Transfer between your Mercury accounts";
  return [
    {
      key: `internal-${n}-in`, kind: "internalTransfer", amount, created: created + r.int(0, 50) * 1000,
      posted: created + r.int(0, 50) * 1000, eta: settle, desc, name: CHECKING_LABEL, cp: CHECKING, account: accountId(other),
    },
    {
      key: `internal-${n}-out`, kind: "internalTransfer", amount: -amount, created, posted: created + r.int(0, 50) * 1000,
      eta: settle, desc, name: CHECKING_LABEL, cp: accountId(other),
    },
  ];
}

/** An ACH or wire that settles within a minute (rent, housing, loans, utilities). */
function instant(key: string, day: string, kind: string, amount: number, name: string, desc: string | null, extra: Partial<Row> = {}): Row {
  const r = rand(key);
  const created = at(day, r, 0, 14);
  return {
    key, kind, amount, created, posted: created + r.int(-40, 40) * 1000,
    eta: iso(created + r.int(-40, 40) * 1000, `eta:${key}`), desc, name, ...extra,
  };
}

/** A Send Money payment: created in the day, posted within hours, delivered within days. */
function sendMoney(key: string, day: string, amount: number, name: string, extra: Partial<Row> = {}, heldDays = 0): Row {
  const r = rand(key);
  const created = at(day, r, 5, 20);
  const posted = created + r.int(5, 120) * 60_000 + heldDays * DAY_MS;
  return {
    key, kind: "outgoingPayment", amount, created, posted, eta: eta(posted, r.int(1, 6)), desc: SEND_MONEY, name,
    ach: ["SAMPLE NATIONAL BANK, NA", "businessChecking"], receipt: true, ...extra,
  };
}

interface Merchant {
  name: string;
  desc: string;
  mcc: string;
  category: string;
  categoryName?: string;
  gl?: string;
  card: string;
}

const M = {
  cloud: { name: "Cloud Office Suite", desc: "Cloud Office Suite_example", mcc: "4816", category: "Software", categoryName: "Software & Subscriptions", card: "c1" },
  city: { name: "City Of Springfield", desc: "CITY OF SPRINGFIELD", mcc: "4900", category: "Utilities", card: "c2" },
  electric: { name: "Example Electric Cooperative", desc: "EXAMPLE ELECTRIC COOP", mcc: "4900", category: "Utilities", categoryName: "Rent & Utilities", card: "c2" },
  power: { name: "Example Power Co", desc: "Example Power Service Co", mcc: "4900", category: "Utilities", categoryName: "Rent & Utilities", card: "c3" },
  water: { name: "Springfield Water Authority", desc: "SPRINGFIELD WATER WEB", mcc: "4900", category: "Utilities", categoryName: "Rent & Utilities", card: "c4" },
  gas: { name: "Example Gas Co", desc: "EXAMPLE GAS CO", mcc: "4900", category: "Utilities", categoryName: "Rent & Utilities", card: "c2" },
  cleaning: { name: "Sparkle Cleaning", desc: "SQ *SPARKLE CLEANING", mcc: "8999", category: "ProfessionalServices", gl: "Cleaning", card: "c5" },
  notary: { name: "Online Notary Co", desc: "ONLINE NOTARY DBA EXAMPLE", mcc: "8999", category: "ProfessionalServices", categoryName: "Legal & Professional Services", card: "c1" },
  mailbox: { name: "Virtual Mailbox Co", desc: "VIRTUAL MAILBOX CO", mcc: "5734", category: "ProfessionalServices", gl: "Office expenses:Software & apps", card: "c1" },
  stay: { name: "Short Stay Co", desc: "SHORTSTAY * TESTCODE01", mcc: "4722", category: "Lodging", categoryName: "Travel & Transportation", gl: "Travel:Hotels", card: "c6" },
  waterWorks: { name: "Example Water Co", desc: "EXAMPLE WATER WORKS C", mcc: "4900", category: "Utilities", gl: "Utilities:Water/ Sewer", card: "c4" },
  gasBill: { name: "Example Gas Bill", desc: "SPI*EXAMPLE GAS BILL", mcc: "4900", category: "Utilities", categoryName: "Other Costs", card: "c7" },
  retailer: { name: "Online Retailer", desc: "ONLINE RETAIL MARKETPLACE", mcc: "5999", category: "Retail", categoryName: "Revenue", gl: "Project Costs", card: "c1" },
  portal: { name: "RentPortal", desc: "RENTPORTAL.EXAMPLE", mcc: "5734", category: "ProfessionalServices", categoryName: "Rent & Utilities", gl: "Rent", card: "c1" },
} satisfies Record<string, Merchant>;

/** A card purchase: authorised in the day, posted the next morning UTC (often the next Jerusalem day). */
function cardSpend(key: string, day: string, merchant: Merchant, lo: number, hi: number, extra: Partial<Row> = {}): Row {
  const r = rand(key);
  const created = at(day, r, 0, 23);
  const posted = created + r.int(2, 26) * 3600_000 + r.int(0, 3599) * 1000;
  return {
    key, kind: "creditCardTransaction", amount: -r.dollars(lo, hi, 25), created, posted, eta: eta(posted, r.int(4, 6)),
    desc: merchant.desc, name: merchant.name, account: CREDIT, card: { key: merchant.card, credit: true },
    period: periodOf(created), categoryName: merchant.categoryName, gl: merchant.gl,
    merchant: { mcc: merchant.mcc, category: merchant.category }, ...extra,
  };
}

function checkDeposit(key: string, day: string, amount: number, name: string, extra: Partial<Row> = {}): Row {
  const r = rand(key);
  const created = at(day, r, 8, 18);
  return {
    key, kind: "checkDeposit", amount, created, posted: at(day, r, 22, 23), eta: eta(created, 7), desc: `Check Deposit From ${name}`,
    name, attachments: ["checkImage", "checkImage"], check: true, ...extra,
  };
}

/** A check deposit that bounced: no postedAt, a failure time and Mercury's reason. */
function failedCheck(key: string, day: string, amount: number, name: string): Row {
  const r = rand(key);
  const created = at(day, r, 6, 20);
  return {
    ...checkDeposit(key, day, amount, name), created, posted: null, status: "failed",
    failed: { at: created + r.int(10, 240) * 60_000, reason: `There was an issue with this transaction. Please contact ${EMAIL}.` },
  };
}

function postedRows(): Row[] {
  const r = rand("amounts");
  const insurerCheck = r.dollars(1500, 4000, 2500);
  const insurerCCheck = r.dollars(20, 80, 25);
  const newrez = r.dollars(1500, 3000, 2500);
  const rows: Row[] = [
    ...autopay("2026-07-31", 1, "IO AUTOPAY"),
    ...autopay("2026-07-27", 2, "IO PAYMENT"),
    ...autopay("2026-07-23", 3, "IO PAYMENT"),
    ...autopay("2026-07-01", 4, "IO AUTOPAY"),
    ...autopay("2026-06-29", 5, "IO PAYMENT"),
    ...autopay("2026-06-25", 6, "IO PAYMENT"),
    ...autopay("2026-06-16", 7, "IO PAYMENT"),
    ...liquidation("2026-07-30", 1, 0),
    ...liquidation("2026-07-04", 2, 3),
    ...liquidation("2026-06-30", 3, 0),
    ...internal("2026-07-02", 1, 6),
    ...internal("2026-06-25", 2, 5),

    // One check from Insurer A cleared once and bounced five times; one from Insurer C bounced, then cleared.
    checkDeposit("check-a-sent", "2026-07-20", insurerCheck, "Insurer A", { categoryName: "Insurance" }),
    failedCheck("check-a-1", "2026-07-20", insurerCheck, "Insurer A Insurance"),
    failedCheck("check-a-2", "2026-07-17", insurerCheck, "Insurer A Insurance"),
    failedCheck("check-a-3", "2026-07-17", insurerCheck, "Insurer A Insurance Group"),
    failedCheck("check-a-4", "2026-07-16", insurerCheck, "Insurer A Insurance Group"),
    failedCheck("check-a-5", "2026-07-16", insurerCheck, "Insurer A"),
    checkDeposit("check-title", "2026-07-17", r.dollars(20, 60, 25), "Title Company A, LLC", { categoryName: "Revenue" }),
    failedCheck("check-c-1", "2026-06-17", insurerCCheck, "Insurer C Fire and Casualty Company"),
    checkDeposit("check-c-sent", "2026-06-19", insurerCCheck, "INSURER C FIRE AND CASUALTY COMPANY", { categoryName: "Revenue" }),

    // Loan servicers, matched by prefix in rules.ts.
    instant("loan-newrez-1", "2026-07-31", "other", -newrez, "NEWREZ-EXAMPLE", "NEWREZ-EXAMPLE; ACH PMT; Person A", { categoryName: "Credit & Loan Payments" }),
    instant("loan-newrez-2", "2026-07-04", "other", -r.dollars(1000, 2000, 2500), "NEWREZ-EXAMPLE", "NEWREZ-EXAMPLE; ACH PMT; Person A", { categoryName: "Credit & Loan Payments" }),
    instant("loan-newrez-3", "2026-07-01", "other", -newrez, "NEWREZ-EXAMPLE", "NEWREZ-EXAMPLE; ACH PMT; Person A", { categoryName: "Credit & Loan Payments" }),
    instant("loan-lakeview", "2026-07-08", "other", -r.dollars(2000, 3500, 5000), "Lakeview Loan Servicing", "LAKEVIEW LOAN; MTG PYMT; Person G", { categoryName: "Credit & Loan Payments" }),
    instant("loan-servease-1", "2026-07-04", "other", -r.dollars(2000, 4000, 5000), "Servease", `SERVEASE; LOAN PMT.; ${BUSINESS.toUpperCase()}`, { categoryName: "Credit & Loan Payments" }),
    instant("loan-servease-2", "2026-07-04", "other", -r.dollars(4000, 7000, 5000), "Servease", `SERVEASE; LOAN PMT.; ${BUSINESS.toUpperCase()}`, { categoryName: "Credit & Loan Payments" }),

    // Income: rent through a portal, a housing authority, an insurer, and wires.
    instant("rent-1", "2026-07-16", "other", r.dollars(100, 500, 500), "RentPortal", `RENTPORTAL.EXAMPLE; TRANSFER; ${BUSINESS.toUpperCase()}`, { gl: "Operating Income" }),
    instant("rent-2", "2026-07-09", "other", r.dollars(1000, 2000, 5000), "RentPortal", `RENTPORTAL.EXAMPLE; TRANSFER; ${BUSINESS.toUpperCase()}`, { gl: "Operating Income" }),
    instant("rent-3", "2026-07-02", "other", r.dollars(3000, 6000, 5000), "RentPortal", `RENTPORTAL.EXAMPLE; TRANSFER; ${BUSINESS.toUpperCase()}`, { gl: "Operating Income" }),
    instant("rent-4", "2026-06-26", "other", r.dollars(500, 1500, 5000), "RentPortal", `RENTPORTAL.EXAMPLE; TRANSFER; ${BUSINESS.toUpperCase()}`),
    instant("rent-5", "2026-06-12", "other", r.dollars(50, 150, 50), "RentPortal", `RENTPORTAL.EXAMPLE; TRANSFER; ${BUSINESS.toUpperCase()}`, { cp: uuid("counterparty:RentPortal#2") }),
    instant("rent-6", "2026-06-10", "other", r.dollars(3000, 5000, 5000), "RentPortal", `RENTPORTAL.EXAMPLE; TRANSFER; ${BUSINESS.toUpperCase()}`),
    instant("housing-1", "2026-07-31", "other", r.dollars(1500, 2500, 5000), "Metro Housing Authority", `MHA HAP; VENDOR PMT; ${BUSINESS.toUpperCase()}`),
    instant("housing-2", "2026-07-01", "other", r.dollars(1500, 2500, 5000), "Metro Housing Authority", `MHA HAP; VENDOR PMT; ${BUSINESS.toUpperCase()}`, { gl: "Operating Income" }),
    instant("insurer-b", "2026-06-30", "other", r.dollars(1500, 3000, 5000), "Insurer B", "INSURER B INSURAN; PAYMENT; Person A", { categoryName: "Insurance" }),
    instant("wire-intl-1", "2026-07-31", "incomingInternationalWire", r.dollars(4000, 8000, 5000), "Person B", null),
    instant("wire-intl-2", "2026-06-25", "incomingInternationalWire", r.dollars(80000, 120000, 5000), "Person B", null),
    instant("wire-domestic", "2026-07-30", "incomingDomesticWire", r.dollars(5000, 9000, 5000), "Person F", null),

    // Send Money payments; two carry a request id and an uploaded receipt, one is a large wire.
    sendMoney("pay-acme", "2026-07-31", -r.dollars(20000, 40000, 10000), "Acme Garage Doors", {
      ach: ["EXAMPLE BANK N.A.", "businessChecking"], attachments: ["other"], request: true,
    }),
    sendMoney("pay-c-1", "2026-07-30", -r.dollars(200, 500, 1000), "Person C", { categoryName: "Rent & Utilities" }),
    sendMoney("pay-b-1", "2026-07-28", -r.dollars(1000, 2000, 5000), "Contractor B Woodworks, LLC"),
    sendMoney("pay-e", "2026-07-23", -r.dollars(20, 80, 100), "Person E", { ach: ["SAMPLE NATIONAL BANK, NA", "personalChecking"] }),
    sendMoney("pay-b-2", "2026-07-21", -r.dollars(1000, 2000, 5000), "Contractor B Woodworks, LLC"),
    sendMoney("pay-d", "2026-07-15", -r.dollars(300, 800, 1000), "Person D", { ach: ["EXAMPLE FEDERAL CREDIT UNION", "businessChecking"] }),
    sendMoney("pay-b-3", "2026-07-07", -r.dollars(1500, 2500, 5000), "Contractor B Woodworks, LLC"),
    sendMoney("pay-settlement", "2026-07-01", -r.dollars(150000, 250000, 10000), "SETTLEMENT AGENT A, INC", {
      ach: undefined, wireBank: "SAMPLE COMMONWEALTH BANK",
    }),
    sendMoney("pay-c-2", "2026-06-30", -r.dollars(800, 1500, 1000), "Person C", { categoryName: "Rent & Utilities", gl: "Cleaning" }),
    sendMoney("pay-c-3", "2026-06-30", -r.dollars(200, 500, 1000), "Person C", { categoryName: "Rent & Utilities", gl: "Cleaning" }),
    sendMoney("pay-contractor-c", "2026-06-27", -r.dollars(500, 1500, 2500), "Contractor C remodeling llc", {
      ach: ["EXAMPLE BANK N.A.", "businessChecking"], categoryName: "Inventory & Materials",
    }, 2),
    sendMoney("pay-c-4", "2026-06-10", -r.dollars(3000, 5000, 5000), "Person C", { categoryName: "Rent & Utilities", gl: "Cleaning" }),
    sendMoney("pay-manager", "2026-06-10", -r.dollars(20, 80, 100), "Property Manager A LLC", {
      ach: ["MERCURY, PARTNERING WITH CHOICE BANK", "businessChecking"], categoryName: "Software & Subscriptions",
      attachments: ["other"], request: true,
    }),

    // Direct debits from other own checking accounts and main checking.
    instant("light-1", "2026-07-03", "other", -r.dollars(100, 200, 500), "Example Light Co", `Example Light Co; PAYMENT; ${BUSINESS.replace(" LLC", "")}`, { account: accountId(6), gl: "Loan Payable – Lender A" }),
    instant("light-2", "2026-06-30", "other", -r.dollars(20, 60, 50), "Example Light Co", "Example Light Co; PAYMENT; Person A", { account: accountId(7), gl: "Loan Payable – Lender A" }),
    instant("light-3", "2026-06-23", "other", -r.dollars(100, 200, 500), "Example Light Co", "Example Light Co; PAYMENT; Person A", { account: accountId(7), gl: "Loan Payable – Lender A" }),
    instant("borough-water", "2026-06-19", "other", -r.dollars(20, 60, 100), "BOROUGH WATER AUTHO", `BOROUGH WATER AUTHO; DIRECT DB; ${BUSINESS.toUpperCase()}`),
    instant("inspector", "2026-06-16", "other", -r.dollars(300, 700, 500), "Home Inspector A", `www.example.test; www.examp; ${BUSINESS.toUpperCase()}`),

    // Card spend on the credit card.
    cardSpend("card-cloud-1", "2026-07-30", M.cloud, 30, 80),
    cardSpend("card-city-1", "2026-07-30", M.city, 100, 250),
    cardSpend("card-electric-1", "2026-07-27", M.electric, 60, 150),
    cardSpend("card-power-1", "2026-07-27", M.power, 5, 20),
    cardSpend("card-water-1", "2026-07-21", M.water, 30, 80),
    cardSpend("card-gas-1", "2026-07-18", M.gas, 80, 180),
    cardSpend("card-power-2", "2026-07-14", M.power, 120, 250),
    cardSpend("card-cleaning", "2026-07-11", M.cleaning, 150, 350),
    cardSpend("card-notary", "2026-07-10", M.notary, 50, 120),
    cardSpend("card-water-2", "2026-07-07", M.water, 150, 300),
    cardSpend("card-mailbox", "2026-07-04", M.mailbox, 20, 50, { attachments: ["receipt"] }),
    cardSpend("card-stay-1", "2026-07-03", M.stay, 800, 1600),
    cardSpend("card-water-works", "2026-07-03", M.waterWorks, 30, 80),
    cardSpend("card-stay-2", "2026-07-02", { ...M.stay, desc: "SHORTSTAY * TESTCODE02" }, 60, 150),
    cardSpend("card-cloud-2", "2026-06-30", { ...M.cloud, mcc: "5817", gl: "Office expenses:Software & apps" }, 80, 150),
    cardSpend("card-stay-3", "2026-06-29", { ...M.stay, desc: "SHORTSTAY * TESTCODE02" }, 400, 700),
    cardSpend("card-gas-bill", "2026-06-27", M.gasBill, 40, 90),
    cardSpend("card-retailer", "2026-06-21", M.retailer, 5, 20),
    cardSpend("card-portal-1", "2026-06-18", M.portal, 100, 200),
    cardSpend("card-portal-2", "2026-06-18", M.portal, 3, 10),
    cardSpend("card-electric-2", "2026-06-16", { ...M.electric, gl: "Utilities:Electric" }, 200, 350),
    cardSpend("card-city-2", "2026-06-16", M.city, 100, 200),

    // A card refund of an earlier charge, and one debit card purchase.
    (() => {
      const refund = cardSpend("card-refund", "2026-06-25", { ...M.retailer, desc: "ONLINE RETAIL* TEST00001", gl: undefined }, 5, 15);
      const amount = -refund.amount;
      return {
        ...refund, kind: "creditCardCredit", amount, posted: refund.created - 15_000,
        related: { kind: "MerchantRefundToOriginalCharge", amount: -amount }, account: CREDIT,
      };
    })(),
    {
      ...cardSpend("debit-tools", "2026-06-15", { name: "Dev Tools Co", desc: "DEV TOOLS CO, INC.", mcc: "5072", category: "Retail", categoryName: "Software & Subscriptions", gl: "Office expenses:Software & apps", card: "d1" }, 2, 6),
      kind: "debitCardTransaction", account: CHECKING, card: { key: "d1", credit: false }, period: undefined,
    },
  ];
  return rows;
}

/** Failed debit card lines from an older window (winter, so local midnight is 22:00 UTC). */
function failedRows(): Row[] {
  const spec: [string, string, string, string | undefined, string | undefined, number, string][] = [
    ["failed-tickets", "2024-12-31", "Ticket Seller A", "TICKET SELLER A, INC.", "Entertainment", 0, "The merchant canceled this transaction, possibly due to incorrect billing information."],
    ["failed-risk", "2025-01-03", "EXAMPLE-RISK SECU", "EXAMPLE-RISK SECU", undefined, -1, "This transaction failed due to an incorrect CVC or expiration date."],
    ["failed-hold", "2025-01-03", "SOFTWARE *TEMP HOLD", "SOFTWARE *TEMP HOLD", undefined, 0, "This transaction failed due to an incorrect CVC or expiration date."],
    ["failed-wallet", "2025-01-30", "Payment Wallet A", "PAYMENT WALLET A", "Retail", 0, "The merchant canceled this transaction, possibly due to incorrect billing information."],
    ["failed-hardware", "2025-03-19", "Hardware Store A", "HARDWARESTORE.EXAMPLE", "Retail", -1, "This transaction failed because it exceeded the spend limit for the card."],
  ];
  const mcc: Record<string, string> = {
    "failed-tickets": "7922", "failed-risk": "6300", "failed-hold": "7399", "failed-wallet": "5999", "failed-hardware": "5200",
  };
  return spec.map(([key, day, name, desc, mercuryCategory, sign, reason]) => {
    const r = rand(key);
    const created = at(day, r, 5, 23);
    return {
      key, kind: "debitCardTransaction", status: "failed", amount: sign === 0 ? 0 : -r.dollars(500, 1500, 1000), created,
      posted: null, eta: eta(created, 6, 22), desc: desc ?? name, name, card: { key: "d0", credit: false },
      failed: { at: created + r.int(5, 3600) * 1000, reason },
      // An authorisation hold in a foreign currency: merchant.currency is the merchant's, not the line's.
      merchant: { mcc: mcc[key], category: mercuryCategory, currency: key === "failed-hold" ? "ILS" : undefined },
    };
  });
}

/** Treasury ledger rows Mercury returns from /treasury/{id}/transactions. Ids are visibly synthetic. */
function treasuryTransactions(liquidation: number) {
  const r = rand("treasury-ledger");
  const interest = r.dollars(5, 20, 100);
  const dividend = r.dollars(2, 10, 100);
  const balance = r.dollars(5000, 10000, 5000);
  return {
    transactions: [
      { id: "11111111-1111-4111-8111-111111111111", accountId: TREASURY, type: "interestPosted", description: "Treasury interest", amount: interest, canonicalDay: "2026-07-29", balance: balance + 300 },
      { id: "22222222-2222-4222-8222-222222222222", accountId: TREASURY, type: "dividendPosted", description: "Treasury dividend", amount: dividend, canonicalDay: "2026-07-14", balance },
      {
        id: "33333333-3333-4333-8333-333333333333", accountId: TREASURY, type: "withdrawalPosted", description: "Liquidation of Treasury assets",
        amount: liquidation, canonicalDay: "2026-06-30", balance: 0, details: { withdrawalCounterpartyId: CHECKING },
      },
    ],
    cursor: null,
  };
}

const NOT_FOUND = {
  status: 404,
  body: { _error: JSON.stringify({ errors: { notFound: [`We couldn’t find the data associated with your request. Please contact ${EMAIL}`] } }) },
};

const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Every fixture file, by name, as the exact text to commit. */
export function buildFixtures(): Map<string, string> {
  const posted = postedRows().map(txn);
  posted.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (posted.length !== 100) throw new Error(`expected 100 posted rows, got ${posted.length}`);
  const page1 = { transactions: posted.slice(0, 50), page: { nextPage: uuid("cursor:page1-next") } };
  const page2 = {
    transactions: posted.slice(50),
    page: { previousPage: uuid("cursor:page2-previous"), nextPage: uuid("cursor:page2-next") },
  };

  // The pending line and the same id after posting, built from a card purchase near the window's end.
  // Created in the Jerusalem day and posted after its midnight, so doc_date and cash_date differ.
  const pendingRow = {
    ...cardSpend("synthetic-pending", "2026-07-30", M.cloud, 30, 80),
    created: at("2026-07-30", rand("synthetic-pending:time"), 6, 18),
  };
  const pending = txn({
    ...pendingRow, status: "pending", posted: null,
    synthetic: "Generated: a card line still pending, postedAt null.",
  });
  const sentPosted = Date.parse(`${new Date(pendingRow.created).toISOString().slice(0, 10)}T23:30:00Z`);
  const sent = txn({
    ...pendingRow, posted: sentPosted,
    synthetic: "Generated: the same id after posting, for the pending -> sent test (amount unchanged).",
  });

  const accounts = accountsFile();
  const credit = creditFile();
  const treasury = treasuryFile();
  const liquidation = posted.find((row) => row.kind === "treasuryTransfer" && row.accountId === TREASURY && String(row.createdAt).startsWith("2026-06-30"));
  if (!liquidation) throw new Error("no treasury liquidation leg on 2026-06-30");
  const ownIds = [...accounts.accounts.map((a) => a.id), CREDIT, TREASURY];

  const failed = failedRows().map(txn);
  failed.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const files = new Map<string, string>();
  files.set("accounts.json", text(accounts));
  files.set("credit.json", text(credit));
  files.set("treasury.json", text(treasury));
  files.set("categories.json", text({ categories: CATEGORY_NAMES.map(category), page: {} }));
  files.set("transactions-desc-page1.json", text(page1));
  files.set("transactions-desc-page2.json", text(page2));
  files.set("transactions-status-pending.json", text({ transactions: [], page: {} }));
  files.set("transactions-status-failed.json", text({ transactions: failed, page: { nextPage: uuid("cursor:failed-next") } }));
  files.set("transaction-by-id.json", text(page1.transactions[0]));
  files.set("transaction-not-found-404.json", text(NOT_FOUND));
  files.set("SYNTHETIC-treasury-transactions.json", text(treasuryTransactions(Number(liquidation.amount))));
  files.set("SYNTHETIC-pending.json", text({ transactions: [pending], page: {} }));
  files.set("SYNTHETIC-pending-then-sent.json", text({ transactions: [sent], page: {} }));
  files.set("canonical-snapshot.json", text(snapshotOf([...page1.transactions, ...page2.transactions], ownIds)));
  return files;
}

if (import.meta.main) {
  const dir = new URL("./fixtures/", import.meta.url);
  for (const [name, body] of buildFixtures()) {
    Deno.writeTextFileSync(new URL(name, dir), body);
  }
}
