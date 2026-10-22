import type { JevBooking, JevBookingApi } from "../jev-bookings";
import { legsFromEntry, type ComposerAccount, type ComposerLeg, type JournalCopies, type JournalSuggestion } from "../line-composer";
import type { ComposerApi } from "../line-composer-api";
import type { LineJournal } from "../line-journal";
import type { ComposerLine, ComposerState } from "../screens/journal-composer-screen";

/**
 * FLOW-955. Invented books for the composer's and the review card's stories and tests: a $200,000 loan
 * from a lender, whose earlier loans were booked as the loan less closing costs, and a mortgage payment.
 * No real data.
 */

export const SAMPLE_COMPOSER_ACCOUNTS: ComposerAccount[] = [
  { id: "a-closing", name: "עלויות סגירה", group: "expense", inPnl: true },
  { id: "a-fees", name: "עמלות בנק", group: "expense", inPnl: true },
  { id: "a-interest", name: "ריבית משכנתא", group: "expense", inPnl: true },
  { id: "a-sales", name: "הכנסות מפרויקט", group: "income", inPnl: true },
  { id: "a-escrow", name: "אסקרו", group: "asset", inPnl: false },
  { id: "a-property", name: "נכסים", group: "asset", inPnl: false },
  { id: "a-loan", name: "הלוואה · Example", group: "liability", inPnl: false },
  { id: "a-principal", name: "קרן הלוואה", group: "liability", inPnl: false },
];

export const SAMPLE_COMPOSER_PROJECTS = [
  { id: "p-herz", name: "פרויקט הרצליה", status: "active" as const },
  { id: "p-raan", name: "פרויקט רעננה", status: "active" as const },
  { id: "p-givat", name: "פרויקט גבעתיים", status: "active" as const },
];

/** $200,000 in from a lender: money in that is not income, so its figure reads "+" in the text colour. */
export const SAMPLE_LOAN_LINE: ComposerLine = {
  id: "t-loan",
  party: "Example Lending",
  docDate: "2026-10-16",
  direction: "income",
  currency: "USD",
  bankAccountId: "a-bank",
  bankMinor: 20_000_000n,
  bankName: "Example Checking ••1234",
  income: false,
};

/** A $2,350 mortgage payment out. */
export const SAMPLE_MORTGAGE_LINE: ComposerLine = {
  ...SAMPLE_LOAN_LINE,
  id: "t-mortgage",
  party: "Example Mortgage",
  docDate: "2026-10-04",
  direction: "expense",
  bankMinor: -235_000n,
};

const entry = (accountId: string, amount: bigint, projectId: string | null = "p-herz") => ({
  account_id: accountId,
  project_id: projectId,
  project_name: projectId == null ? null : SAMPLE_COMPOSER_PROJECTS.find((project) => project.id === projectId)?.name ?? null,
  amount_minor: amount,
});

/** Jev's suggestion: three earlier loans, each the deposit plus 3% closing costs taken off the loan, scaled to $200,000. */
export const SAMPLE_SUGGESTION: JournalSuggestion = {
  party_name: "Example Lending",
  basis_count: 3,
  source_transaction_id: "t-past-1",
  legs: [entry("a-closing", 600_000n), entry("a-loan", -20_600_000n)],
};

const journalLeg = (ordinal: number, name: string, type: "income" | "expense" | "asset" | "liability", amount: bigint, extra: Partial<LineJournal["legs"][number]> = {}): LineJournal["legs"][number] => ({
  ordinal,
  account_id: `j${String(ordinal)}`,
  account_name: name,
  account_type: type,
  system: false,
  is_bank: false,
  in_pnl: type === "income" || type === "expense",
  category_name: name,
  project_id: "p-herz",
  project_name: "פרויקט הרצליה",
  amount_minor: amount,
  ...extra,
});

const pastLegs = (bank: bigint, closing: bigint): LineJournal["legs"] => [
  journalLeg(1, "Bank/Clearing", "asset", bank, { system: true, is_bank: true, in_pnl: false, category_name: null, project_id: null, project_name: null }),
  journalLeg(2, "עלויות סגירה", "expense", closing),
  journalLeg(3, "הלוואה · Example", "liability", -(bank + closing), { in_pnl: false }),
];

/** Three loans booked earlier, each copied scaled to this line. */
export const SAMPLE_COPIES: JournalCopies = {
  party_name: "Example Lending",
  lines: [
    { transaction_id: "t-past-1", doc_date: "2026-08-02", amount_gross: 15_000_000n, legs: pastLegs(15_000_000n, 450_000n), scaled: [entry("a-closing", 600_000n), entry("a-loan", -20_600_000n)] },
    { transaction_id: "t-past-2", doc_date: "2026-05-11", amount_gross: 18_000_000n, legs: pastLegs(18_000_000n, 540_000n), scaled: [entry("a-closing", 600_000n), entry("a-loan", -20_600_000n)] },
    { transaction_id: "t-past-3", doc_date: "2026-01-20", amount_gross: 12_000_000n, legs: pastLegs(12_000_000n, 360_000n), scaled: [entry("a-closing", 600_000n), entry("a-loan", -20_600_000n)] },
  ],
};

export const SAMPLE_JEV_START: ComposerState = { start: "jev", legs: legsFromEntry(SAMPLE_SUGGESTION.legs), copied: null };
export const SAMPLE_COPY_START: ComposerState = { start: "copy", legs: legsFromEntry(SAMPLE_COPIES.lines[0]?.scaled ?? []), copied: "t-past-1" };
export const SAMPLE_SCRATCH_START: ComposerState = {
  start: "free",
  legs: [{ key: "scratch", accountId: null, projectId: null, side: "credit", amount: "" }],
  copied: null,
};

/** Jev's legs with the loan typed as the deposit alone: the credits are $6,000 short. */
export const SAMPLE_UNBALANCED_START: ComposerState = {
  start: "jev",
  legs: SAMPLE_JEV_START.legs.map((leg): ComposerLeg => (leg.accountId === "a-loan" ? { ...leg, amount: "200000" } : leg)),
  copied: null,
};

/** A free entry of three lines that balance: closing costs, a bank fee and the loan. */
export const SAMPLE_BALANCED_START: ComposerState = {
  start: "free",
  legs: [
    { key: "b1", accountId: "a-closing", projectId: "p-herz", side: "debit", amount: "6000" },
    { key: "b2", accountId: "a-fees", projectId: null, side: "debit", amount: "500" },
    { key: "b3", accountId: "a-loan", projectId: "p-herz", side: "credit", amount: "206500" },
  ],
  copied: null,
};

/** The mortgage payment split three ways: interest counts, escrow and principal are kept out. */
export const SAMPLE_MORTGAGE_START: ComposerState = {
  start: "free",
  legs: [
    { key: "m1", accountId: "a-interest", projectId: "p-raan", side: "debit", amount: "1400" },
    { key: "m2", accountId: "a-escrow", projectId: "p-raan", side: "debit", amount: "600" },
    { key: "m3", accountId: "a-principal", projectId: "p-raan", side: "debit", amount: "350" },
  ],
  copied: null,
};

/** A save that answers after a moment, or refuses with a server reason. */
export function sampleComposerApi(refuse?: string): ComposerApi {
  return {
    save: (legs) => new Promise((resolve, reject) => {
      window.setTimeout(() => {
        if (refuse != null) reject(new Error(refuse));
        else resolve({ transactionId: "t-loan", before: [] });
      }, legs.length > 0 ? 300 : 0);
    }),
    undo: () => Promise.resolve(),
  };
}

/** Jev's booking of the loan, waiting in לאישור, and a second one after it. */
export const SAMPLE_JEV_BOOKINGS: JevBooking[] = [
  {
    write_id: "w-loan",
    transaction_id: "t-loan",
    kind: "line_split",
    party: "Example Lending",
    doc_date: "2026-10-16",
    direction: "income",
    amount_gross: 20_000_000n,
    currency: "USD",
    source: "mercury",
    journal: {
      currency: "USD",
      balanced: true,
      booked_by_ai: true,
      legs: [
        journalLeg(1, "Bank/Clearing", "asset", 20_000_000n, { system: true, is_bank: true, in_pnl: false, category_name: null, project_id: null, project_name: null }),
        journalLeg(2, "עלויות סגירה", "expense", 600_000n),
        journalLeg(3, "הלוואה · Example", "liability", -20_600_000n, { in_pnl: false }),
      ],
    },
  },
  {
    write_id: "w-mortgage",
    transaction_id: "t-mortgage",
    kind: "line_split",
    party: "Example Mortgage",
    doc_date: "2026-10-04",
    direction: "expense",
    amount_gross: -235_000n,
    currency: "USD",
    source: "mercury",
    journal: {
      currency: "USD",
      balanced: true,
      booked_by_ai: true,
      legs: [
        journalLeg(1, "ריבית משכנתא", "expense", 140_000n, { project_name: "פרויקט רעננה" }),
        journalLeg(2, "Escrow", "asset", 60_000n, { system: true, in_pnl: false, category_name: "מסים וביטוח", project_name: "פרויקט רעננה" }),
        journalLeg(3, "Loan principal", "liability", 35_000n, { system: true, in_pnl: false, category_name: "קרן", project_name: "פרויקט רעננה" }),
        journalLeg(4, "Bank/Clearing", "asset", -235_000n, { system: true, is_bank: true, in_pnl: false, category_name: null, project_id: null, project_name: null }),
      ],
    },
  },
];

/** אישור and ביטול that answer at once. */
export const SAMPLE_JEV_BOOKING_API: JevBookingApi = {
  approve: () => Promise.resolve(),
  undo: () => Promise.resolve(),
};
