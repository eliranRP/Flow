import { z } from "zod";
import { amountOf, amountText } from "./line-split";
import { legName, type JournalLeg } from "./line-journal";
import { SYSTEM_NAMES } from "./system-accounts";

/**
 * FLOW-955 (decision 0208). The journal entry composer ("פקודת יומן", board LedgerComposer): the
 * line's bank leg stays as it is (שורה 1) and every other line is an account, a project, an amount
 * and a side (חובה or זכות). It saves through `save_line_journal`, book_line's rules, once the
 * debits equal the credits. Pure logic here; the reads and the save are in line-composer-api.ts.
 */

export type ComposerSide = "debit" | "credit";

/** One editable line of the entry. `amount` is what the field holds ("6500", "6500.25"). */
export type ComposerLeg = {
  key: string;
  accountId: string | null;
  projectId: string | null;
  side: ComposerSide;
  amount: string;
};

export type AccountGroup = "income" | "expense" | "asset" | "liability" | "equity";

/** A bookable account as the composer shows it: the name, its type's words, and whether it counts in profit. */
export type ComposerAccount = {
  id: string;
  name: string;
  group: AccountGroup;
  inPnl: boolean;
};

const rawAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["income", "expense", "asset", "liability", "equity"]),
  system: z.boolean(),
  is_bank: z.boolean(),
  excluded_from_pnl: z.boolean(),
  hidden: z.boolean(),
  bookable: z.boolean(),
  posts_to: z.string().nullable().optional(),
});

const accountsSchema = z.object({ accounts: z.array(rawAccountSchema) });

/** The order of the picker's groups and their headings. */
export const ACCOUNT_GROUPS: ReadonlyArray<{ group: AccountGroup; heading: string }> = [
  { group: "expense", heading: "הוצאות" },
  { group: "income", heading: "הכנסות" },
  { group: "asset", heading: "נכסים" },
  { group: "liability", heading: "התחייבויות" },
  { group: "equity", heading: "הון עצמי" },
];

/**
 * `mcp_accounts` → the accounts a composer line can take: every bookable account but the bank (it is
 * שורה 1) and a hidden category. A system account reads in Hebrew. A kept-out category's account
 * belongs to the group of the balance-sheet account it posts to, outside profit.
 */
export function composerAccounts(data: unknown): ComposerAccount[] {
  const { accounts } = accountsSchema.parse(data);
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return accounts
    .filter((account) => account.bookable && !account.is_bank && !account.hidden)
    .map((account) => {
      const target = account.posts_to != null ? byId.get(account.posts_to) : undefined;
      const group: AccountGroup = account.excluded_from_pnl && target != null ? target.type : account.type;
      return {
        id: account.id,
        name: account.system ? (SYSTEM_NAMES[account.name] ?? account.name) : account.name,
        group,
        inPnl: !account.excluded_from_pnl && (group === "income" || group === "expense"),
      };
    });
}

/** The words for an account's group, as the journal card says them. */
export function groupLabel(group: AccountGroup): string {
  switch (group) {
    case "income":
      return "הכנסה";
    case "expense":
      return "הוצאה";
    case "asset":
      return "נכס";
    case "liability":
      return "התחייבות";
    case "equity":
      return "הון";
  }
}

/** "הוצאה · נספר ברווח" under a line, or "בחרו חשבון" while it has none. */
export function legNote(account: ComposerAccount | undefined): string {
  if (account == null) return "בחרו חשבון";
  return `${groupLabel(account.group)} · ${account.inPnl ? "נספר ברווח" : "לא נספר ברווח"}`;
}

let keySeed = 0;
export function newLegKey(): string {
  keySeed += 1;
  return `leg-${String(keySeed)}`;
}

/** A scaled or booked entry leg from the server (signed: a debit is positive). */
const entryLegSchema = z.object({
  account_id: z.string(),
  project_id: z.string().nullable(),
  project_name: z.string().nullable().optional(),
  amount_minor: z.union([z.number(), z.string()]).transform((value) => BigInt(value)),
});
export type EntryLeg = z.infer<typeof entryLegSchema>;

/** Server legs → the composer's lines, each on its side with a positive amount. */
export function legsFromEntry(legs: readonly EntryLeg[]): ComposerLeg[] {
  return legs.map((leg) => ({
    key: newLegKey(),
    accountId: leg.account_id,
    projectId: leg.project_id,
    side: leg.amount_minor > 0n ? "debit" : "credit",
    amount: amountText(leg.amount_minor),
  }));
}

/** The line's own journal legs (not the bank) → the composer's lines, to edit what is booked now. */
export function legsFromJournal(legs: readonly JournalLeg[]): ComposerLeg[] {
  return legsFromEntry(legs.filter((leg) => !leg.is_bank).map((leg) => ({
    account_id: leg.book_account_id ?? leg.account_id,
    project_id: leg.project_id ?? null,
    amount_minor: leg.amount_minor,
  })));
}

export type ComposerBalance = {
  debit: bigint;
  credit: bigint;
  /** debit − credit: above zero the credits are short, below zero the debits. */
  diff: bigint;
  /** Every line has an account and an amount above zero, and there is at least one. */
  complete: boolean;
  balanced: boolean;
};

/**
 * The entry's two sides. The bank leg is on the debit side when money came in (`bankMinor` is the
 * line's signed bank movement), else on the credit side.
 */
export function composerBalance(bankMinor: bigint, legs: readonly ComposerLeg[]): ComposerBalance {
  let debit = bankMinor > 0n ? bankMinor : 0n;
  let credit = bankMinor < 0n ? -bankMinor : 0n;
  let complete = legs.length > 0;
  for (const leg of legs) {
    const minor = amountOf(leg.amount);
    if (leg.accountId == null || minor == null) complete = false;
    if (minor == null) continue;
    if (leg.side === "debit") debit += minor;
    else credit += minor;
  }
  const diff = debit - credit;
  return { debit, credit, diff, complete, balanced: complete && diff === 0n };
}

/**
 * Why save waits: the sides differ ("short" on a side, by an amount), a line is missing its account
 * or amount, or the entry has one line only (book_line takes that as an assignment, not an entry).
 */
export type ComposerHold =
  | { kind: "balanced"; total: bigint }
  | { kind: "short"; side: ComposerSide; minor: bigint }
  | { kind: "incomplete" }
  | { kind: "single"; total: bigint };

export function composerHold(bankMinor: bigint, legs: readonly ComposerLeg[]): ComposerHold {
  const balance = composerBalance(bankMinor, legs);
  if (balance.diff > 0n) return { kind: "short", side: "credit", minor: balance.diff };
  if (balance.diff < 0n) return { kind: "short", side: "debit", minor: -balance.diff };
  if (!balance.complete) return { kind: "incomplete" };
  if (legs.length < 2) return { kind: "single", total: balance.debit };
  return { kind: "balanced", total: balance.debit };
}

/** What "+ שורה נוספת" adds: on the short side with what is missing, else an empty credit. */
export function nextLeg(bankMinor: bigint, legs: readonly ComposerLeg[]): ComposerLeg {
  const { diff } = composerBalance(bankMinor, legs);
  return {
    key: newLegKey(),
    accountId: null,
    projectId: null,
    side: diff < 0n ? "debit" : "credit",
    amount: diff === 0n ? "" : amountText(diff < 0n ? -diff : diff),
  };
}

/** The legs `save_line_journal` books: the bank leg as the line moved, then each line signed. */
export function bookingPayload(bankAccountId: string, bankMinor: bigint, legs: readonly ComposerLeg[]): Array<{ account_id: string; amount_minor: number; project_id?: string }> | null {
  const out: Array<{ account_id: string; amount_minor: number; project_id?: string }> = [
    { account_id: bankAccountId, amount_minor: Number(bankMinor) },
  ];
  for (const leg of legs) {
    const minor = amountOf(leg.amount);
    if (leg.accountId == null || minor == null) return null;
    out.push({
      account_id: leg.accountId,
      amount_minor: Number(leg.side === "debit" ? minor : -minor),
      ...(leg.projectId != null ? { project_id: leg.projectId } : {}),
    });
  }
  return out;
}

const splitPartSchema = z.object({
  category_id: z.string(),
  project_id: z.string().nullable(),
  amount_minor: z.union([z.number(), z.string()]).transform((value) => BigInt(value)),
  gross_up: z.boolean().nullable().optional(),
});

const savedSchema = z.object({
  transaction_id: z.string(),
  before: z.array(splitPartSchema).nullable(),
});

export type SavedBooking = { transactionId: string; before: Array<z.infer<typeof splitPartSchema>> };

export function parseSaved(data: unknown): SavedBooking {
  const saved = savedSchema.parse(data);
  return { transactionId: saved.transaction_id, before: saved.before ?? [] };
}

/** ביטול after a save: the parts before, for `save_line_split` (an empty list clears the split). */
export function undoParts(before: SavedBooking["before"]): Array<{ category_id: string; project_id: string | null; amount_minor: number; gross_up?: true }> {
  return before.map((part) => ({
    category_id: part.category_id,
    project_id: part.project_id,
    amount_minor: Number(part.amount_minor),
    ...(part.gross_up === true ? { gross_up: true as const } : {}),
  }));
}

const suggestionSchema = z.object({
  party_name: z.string().nullable(),
  basis_count: z.number().int(),
  source_transaction_id: z.string(),
  legs: z.array(entryLegSchema),
}).nullable();

export type JournalSuggestion = NonNullable<z.infer<typeof suggestionSchema>>;

export function parseSuggestion(data: unknown): JournalSuggestion | null {
  return suggestionSchema.parse(data);
}

const journalLegSchema = z.object({
  ordinal: z.number().int(),
  account_id: z.string(),
  account_name: z.string(),
  account_type: z.enum(["income", "expense", "asset", "liability", "equity"]),
  system: z.boolean(),
  is_bank: z.boolean(),
  in_pnl: z.boolean(),
  category_name: z.string().nullable(),
  project_id: z.string().nullable().optional(),
  project_name: z.string().nullable(),
  amount_minor: z.union([z.number(), z.string()]).transform((value) => BigInt(value)),
});

const copiesSchema = z.object({
  party_name: z.string().nullable(),
  lines: z.array(z.object({
    transaction_id: z.string(),
    doc_date: z.string(),
    amount_gross: z.union([z.number(), z.string()]).transform((value) => BigInt(value)),
    legs: z.array(journalLegSchema).nullable(),
    scaled: z.array(entryLegSchema),
  })),
}).nullable();

export type JournalCopies = NonNullable<z.infer<typeof copiesSchema>>;
export type JournalCopy = JournalCopies["lines"][number];

export function parseCopies(data: unknown): JournalCopies | null {
  return copiesSchema.parse(data);
}

/** A past line's side, as "name $amount" pairs: ["בנק $145,500", "עלויות סגירה $4,500"]. */
export function copySidePairs(
  copy: JournalCopy,
  side: ComposerSide,
  format: (minor: bigint) => string,
): string[] {
  const legs = (copy.legs ?? []).filter((leg) => (side === "debit" ? leg.amount_minor > 0n : leg.amount_minor < 0n));
  return legs.map((leg) => {
    const name = leg.is_bank ? "בנק" : legName(leg, null);
    return `${name} ${format(leg.amount_minor < 0n ? -leg.amount_minor : leg.amount_minor)}`;
  });
}

/** dd/mm of an ISO date, as the board writes the copy sheet's dates. */
export function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** The refusals `save_line_journal` can raise, in the composer's words. */
export function composerRefusal(message: string): string {
  if (/legs do not balance/.test(message)) return "הפקודה לא מאוזנת. בדקו את הסכומים.";
  if (/use assign_expense|at least one category leg/.test(message)) return "פקודה עם שורה אחת היא שיוך רגיל. שייכו את התנועה במסך שלה.";
  if (/line has an open review/.test(message)) return "התנועה ממתינה לאישור. אשרו אותה קודם.";
  if (/line has a loan split/.test(message)) return "לתנועה יש פיצול הלוואה. ערכו אותו במסך ההלוואה.";
  if (/a line with VAT/.test(message)) return "עדיין אי אפשר לרשום פקודה לתנועה עם מע״מ.";
  if (/the line is not posted/.test(message)) return "התנועה עוד לא נקלטה בספרים.";
  if (/kept out of the P&L|switched into the P&L/.test(message)) return "התנועה הוצאה ידנית מהרווח או הוכנסה אליו. בטלו את זה קודם.";
  if (/several kept-out categories post/.test(message)) return "כמה קטגוריות נרשמות לחשבון הזה. בחרו את הקטגוריה עצמה.";
  if (/transaction not found|account not found|project not found/.test(message)) return "התנועה או החשבון כבר לא קיימים. רעננו ונסו שוב.";
  return "לא הצלחנו לשמור את הפקודה.";
}
