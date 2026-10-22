import { journalSides, legKeptOut, legName, legTypeLabel, type JournalLeg, type LineJournal } from "../line-journal";
import { JournalCard, type JournalRow } from "../ui/journal-card";

/** A line's journal has something to show: a pending line has no legs. */
export function journalShown(journal: LineJournal | null | undefined): journal is LineJournal {
  return journal != null && journal.legs.length > 0;
}

/** A line with a leg outside the P&L shows its journal open (owner, 2026-10-22). */
export function journalOpens(journal: LineJournal): boolean {
  return journal.legs.some(legKeptOut);
}

/**
 * FLOW-954. The line screen's פקודת יומן, from `get_line_journal`: the legs named for the screen (the
 * bank leg is the bank account the line moved through, from the line's bank details). The composer
 * (עריכה) comes with the next PR, so the card here is read only.
 */
export function TxnJournal({ journal, bankName, collapsible = false }: { journal: LineJournal; bankName: string | null; collapsible?: boolean }) {
  const { debit, credit } = journalSides(journal.legs);
  const row = (leg: JournalLeg): JournalRow => ({
    key: String(leg.ordinal),
    name: legName(leg, bankName),
    type: legTypeLabel(leg),
    project: leg.project_name,
    amount: leg.amount_minor < 0n ? -leg.amount_minor : leg.amount_minor,
    keptOut: legKeptOut(leg),
  });
  return (
    <JournalCard
      debit={debit.map(row)}
      credit={credit.map(row)}
      currency={journal.currency}
      balanced={journal.balanced}
      bookedByAi={journal.booked_by_ai}
      collapsible={collapsible}
    />
  );
}
