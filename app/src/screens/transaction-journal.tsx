import type { TransactionDetail } from "@flow/shared";
import { journalSides, legKeptOut, legName, legTypeLabel, type JournalLeg, type LineJournal } from "../line-journal";
import { JournalCard, type JournalRow } from "../ui/journal-card";

/** A line's journal has something to show: a pending line has no legs. */
export function journalShown(journal: LineJournal | null | undefined): journal is LineJournal {
  return journal != null && journal.legs.length > 0;
}

/** The legs as the card draws them, each side in ledger order (the bank leg named by its account). */
export function journalRows(journal: LineJournal, bankName: string | null): { debit: JournalRow[]; credit: JournalRow[] } {
  const { debit, credit } = journalSides(journal.legs);
  const row = (leg: JournalLeg): JournalRow => ({
    key: String(leg.ordinal),
    name: legName(leg, bankName),
    type: legTypeLabel(leg),
    project: leg.project_name,
    amount: leg.amount_minor < 0n ? -leg.amount_minor : leg.amount_minor,
    keptOut: legKeptOut(leg),
  });
  return { debit: debit.map(row), credit: credit.map(row) };
}

/**
 * FLOW-955: the composer can book this line. `save_line_journal` (book_line's rules) always refuses a
 * line with VAT, a loan split, an open review (other than a split that no longer matches), or a manual
 * switch in or out of the P&L, so such a line gets no עריכה.
 */
export function journalEditable(txn: Pick<NonNullable<TransactionDetail>, "vat_amount" | "loan_split" | "in_pnl_override" | "review_status" | "review_reason">): boolean {
  if (txn.vat_amount !== 0n) return false;
  if (txn.loan_split != null) return false;
  if (txn.in_pnl_override != null) return false;
  return !(txn.review_status === "open" && txn.review_reason !== "split_mismatch");
}

/** A line with a leg outside the P&L shows its journal open (owner, 2026-10-22). */
export function journalOpens(journal: LineJournal): boolean {
  return journal.legs.some(legKeptOut);
}

/**
 * FLOW-954. The line screen's פקודת יומן, from `get_line_journal`: the legs named for the screen (the
 * bank leg is the bank account the line moved through, from the line's bank details). FLOW-955: `editTo`
 * draws עריכה, to the composer (left out for a viewer).
 */
export function TxnJournal({ journal, bankName, collapsible = false, editTo }: { journal: LineJournal; bankName: string | null; collapsible?: boolean; editTo?: string }) {
  const { debit, credit } = journalRows(journal, bankName);
  return (
    <JournalCard
      debit={debit}
      credit={credit}
      currency={journal.currency}
      balanced={journal.balanced}
      bookedByAi={journal.booked_by_ai}
      collapsible={collapsible}
      editTo={editTo}
    />
  );
}
