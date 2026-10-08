import { ApproxAmount } from "./approx-amount";
import type { ExpectedMonthRow, ExpectedPartyRow } from "./expected-months";
import { Sheet } from "./sheet";

/** The parties behind one expected month: name and amount, income in green. Read only. */
export function ExpectedMonthParties({ parties }: { parties: readonly ExpectedPartyRow[] }) {
  return (
    <ul className="ui-expected-parties">
      {parties.map((party) => (
        <li key={party.id} className="ui-row">
          <span className="ui-row-main">
            <span className="ui-row-text">
              <span className="ui-row-title">{party.name === "" ? "ללא שם" : party.name}</span>
            </span>
          </span>
          <ApproxAmount minor={party.minor} currency={party.currency} income={party.direction === "income"} />
        </li>
      ))}
    </ul>
  );
}

/**
 * FLOW-403, plan option A4: a tap on a month opens who makes up its figure. No edit in the sheet.
 * The title is the month's label; the sheet keeps its last month while it closes.
 */
export function ExpectedMonthSheet({
  month,
  open,
  onOpenChange,
}: {
  month: ExpectedMonthRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open && month != null} onOpenChange={onOpenChange} title={month?.label ?? ""}>
      {month == null ? null : <ExpectedMonthParties parties={month.parties} />}
    </Sheet>
  );
}
