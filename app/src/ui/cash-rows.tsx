import { formatAmountText } from "@flow/shared";
import { Link } from "react-router-dom";
import { BigNumber } from "./big-number";
import { ChevronIcon } from "./icons";

/**
 * FLOW-413, frame b. The cash view's rows: נכנס (green), יצא and a quiet רווח החודש under its
 * figure, and the earlier months. They share the look of Home's income and expense rows
 * (ui-flow-line), and each row opens what is behind it. A currency other than the base adds a line under the first amount.
 */

/** "in" is green; "net" (a month row) and "quiet" (רווח החודש) show a loss in red with its minus. */
export type CashRowTone = "in" | "out" | "net" | "quiet";

export type CashRow = {
  id: string;
  label: string;
  tone: CashRowTone;
  amounts: { currency: string; minor: bigint }[];
  href: string;
  /** Read in full by a screen reader: "נכנס באוקטובר ₪18,000 – פירוט". */
  name: string;
};

/** The amounts as a screen reader hears them: a loss keeps its minus. */
export function cashAmountsText(amounts: { currency: string; minor: bigint }[]): string {
  return amounts.map((amount) => formatAmountText(amount.minor, amount.currency)).join(", ");
}

export function CashRows({ rows }: { rows: CashRow[] }) {
  return (
    <div className="ui-flow">
      {rows.map((row) => (
        <Link
          key={row.id}
          to={row.href}
          className={row.tone === "quiet" ? "ui-flow-line ui-flow-link ui-hit ui-cash-quiet" : "ui-flow-line ui-flow-link ui-hit"}
          aria-label={row.name}
        >
          <span className="ui-flow-label t-body">{row.label}</span>
          <span className="ui-flow-amounts">
            {row.amounts.map((amount) => (
              <BigNumber
                key={amount.currency}
                agorot={amount.minor}
                currency={amount.currency}
                size="list"
                income={row.tone === "in"}
                loss={(row.tone === "quiet" || row.tone === "net") && amount.minor < 0n}
              />
            ))}
          </span>
          <span className="ui-flow-chevron" aria-hidden="true">
            <ChevronIcon />
          </span>
        </Link>
      ))}
    </div>
  );
}
