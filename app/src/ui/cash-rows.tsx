import { formatAmountText } from "@flow/shared";
import { Link } from "react-router-dom";
import { BigNumber } from "./big-number";
import { ChevronIcon } from "./icons";

/**
 * FLOW-413, frame b. The cash view's rows: נכנס (green), יצא and a quiet רווח החודש under its
 * figure, then (FLOW-418) a quiet לא נספר ברווח with a hint naming what it holds, and the earlier
 * months. They share the look of Home's income and expense rows (ui-flow-line), and each row opens
 * what is behind it. A currency other than the base adds a line under the first amount.
 */

/**
 * "in" is green; "net" (a month row) and "quiet" (רווח החודש) show a loss in red with its minus.
 * "aside" (FLOW-418, לא נספר ברווח) reads quiet and keeps its minus without red: it is not a loss.
 */
export type CashRowTone = "in" | "out" | "net" | "quiet" | "aside";

export type CashRow = {
  id: string;
  label: string;
  /** A short line under the label: FLOW-418 "שיפוץ והשבחה, השקעת בעלים", FLOW-417 "10 חודשים". */
  hint?: string;
  tone: CashRowTone;
  amounts: { currency: string; minor: bigint }[];
  /** Where the row opens. A row without one is a figure only (a year's נכנס and יצא). */
  href?: string;
  /** רווח החודש: the month the profit view opens on. */
  profitMonth?: string;
  /** Read in full by a screen reader: "נכנס באוקטובר ₪18,000 – פירוט". */
  name: string;
};

/** The amounts as a screen reader hears them: a loss keeps its minus. */
export function cashAmountsText(amounts: { currency: string; minor: bigint }[]): string {
  return amounts.map((amount) => formatAmountText(amount.minor, amount.currency)).join(", ");
}

export function CashRows({ rows, onOpen, months = false }: { rows: CashRow[]; onOpen?: (row: CashRow) => void; months?: boolean }) {
  return (
    // The earlier months sit under their own heading, so they drop the section gap and name each month in full text.
    <div className={months ? "ui-flow ui-cash-months" : "ui-flow"}>
      {rows.map((row) => {
        const body = (
          <>
            {row.hint == null ? (
              <span className="ui-flow-label t-body">{row.label}</span>
            ) : (
              <span className="ui-flow-labels">
                <span className="ui-flow-label t-body">{row.label}</span>
                <span className="ui-flow-hint t-hint">{row.hint}</span>
              </span>
            )}
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
          </>
        );
        if (row.href == null) {
          return (
            <p key={row.id} className="ui-flow-line" aria-label={row.name}>
              {body}
            </p>
          );
        }
        return (
          <Link
            key={row.id}
            to={row.href}
            className={row.tone === "quiet" || row.tone === "aside" ? "ui-flow-line ui-flow-link ui-hit ui-cash-quiet" : "ui-flow-line ui-flow-link ui-hit"}
            aria-label={row.name}
            onClick={onOpen == null ? undefined : () => {
              onOpen(row);
            }}
          >
            {body}
            <span className="ui-flow-chevron" aria-hidden="true">
              <ChevronIcon />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
