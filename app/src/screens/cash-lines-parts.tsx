import { formatAmountText, type CashCurrencyRow } from "@flow/shared";
import type { KeyboardEvent } from "react";
import { type CashListSide, notInProfitMinor, notInProfitRest } from "../cash";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { DocumentIcon } from "../ui/icons";
import { onRadioArrow, SegmentedControl } from "../ui/segmented-control";
import { Skeleton } from "../ui/skeleton";

/**
 * The parts of a נכנס, יצא or לא נספר ברווח page that the company's and the project's pages share.
 * Each page still loads its own lines and draws its own rows.
 */

/** FLOW-418: the lines page's one line on what these are. */
const KEPT_NOTE = "כסף שזז בבנק, אבל אינו הכנסה או הוצאה.";

/** The figure a lines page heads with, and the VAT and kept-out remainder its note names, in the shown currency. */
export function cashLinesFigures(
  shown: readonly CashCurrencyRow[],
  side: CashListSide,
  currency: string,
): { figure: bigint | null; rest: bigint } {
  const total = shown.find((row) => row.currency === currency);
  const figure = total == null ? null : side === "in" ? total.in_minor : side === "out" ? total.out_minor : notInProfitMinor(total);
  // FLOW-418: VAT, and lines out of the view but in profit, are in the figure but have no row here.
  const rest = side === "kept" && total != null ? notInProfitRest(total) : 0n;
  return { figure, rest };
}

/** The figure under the header, and on לא נספר ברווח the note that says what these lines are. */
export function CashLinesHead({ side, currency, figure, rest }: { side: CashListSide; currency: string; figure: bigint | null; rest: bigint }) {
  return (
    <>
      {figure != null ? (
        <p className="ui-breakdown-total ui-page-pad">
          <span className="ui-breakdown-total-line">
            <Amount agorot={figure} currency={currency} size="total" income={side === "in"} />
          </span>
        </p>
      ) : null}
      {side === "kept" ? (
        <p className="ui-breakdown-hint ui-page-pad t-caption t-muted">
          {rest === 0n ? KEPT_NOTE : `${KEPT_NOTE} מזה ${formatAmountText(rest, currency)} מע״מ והפרשים, שאינם ברשימה.`}
        </p>
      ) : null}
    </>
  );
}

/** The currency switch, shown only when the month has more than one currency. */
export function CashCurrencySwitch({
  currencies,
  currency,
  onChange,
}: {
  currencies: readonly string[];
  currency: string;
  onChange: (next: string) => void;
}) {
  if (currencies.length < 2) return null;
  return (
    <div className="ui-page-pad">
      <SegmentedControl
        label="מטבע"
        showLabel={false}
        value={currency}
        options={currencies.map((code) => ({ value: code, label: code }))}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * A lines page with no line: what is missing for this side. FLOW-965: on נכנס and יצא it says so for the
 * month ("עוד לא נכנס כסף באוקטובר" while the month runs) with one way on, the other side's lines.
 */
export function CashLinesEmpty({ side, rest, month, current, onOther }: { side: CashListSide; rest: bigint; month: string; current: boolean; onOther: () => void }) {
  if (side === "kept") {
    return <EmptyState icon={<DocumentIcon />} title={rest === 0n ? "הכול נספר ברווח החודש" : "אין תנועות שמחוץ לרווח"} body="תנועות שנכנסות לתזרים יופיעו כאן." />;
  }
  const moved = side === "in" ? "נכנס" : "יצא";
  return (
    <div className="ui-lines-state">
      <section className="ui-card ui-page-failed ui-lines-empty">
        <span className="ui-band-failed-icon" aria-hidden="true">
          <DocumentIcon size={24} />
        </span>
        <h2 className="ui-band-failed-title">{`${current ? "עוד לא " : "לא "}${moved} כסף ב${month}`}</h2>
        <p className="ui-band-failed-body">{current ? "שורות חדשות מגיעות מהבנק כמה פעמים ביום." : "תנועות שנכנסות לתזרים יופיעו כאן."}</p>
        <Button onClick={onOther}>{`מה ${side === "in" ? "יצא" : "נכנס"} ב${month}`}</Button>
      </section>
    </div>
  );
}

/**
 * FLOW-366: the total of a lines page on נכנס or יצא, in Home's figure for the side. A skeleton bar
 * until every page is in, because the total comes from the lines.
 */
export function LinesTotal({ side, currency, total }: { side: CashListSide; currency: string; total: bigint | null }) {
  if (total == null) {
    return (
      <p className="ui-breakdown-total">
        <Skeleton width="md" />
      </p>
    );
  }
  return (
    <p className="ui-breakdown-total">
      <span className="ui-breakdown-total-line">
        <Amount agorot={total} currency={currency} size="total" income={side === "in"} />
      </span>
    </p>
  );
}

/**
 * FLOW-366: "N תנועות · $X לא נספרים ברווח"; the out-of-profit part shows only when it applies. FLOW-965: the
 * lines waiting for approval are the review button under it, not a part of this line.
 */
export function LinesCount({
  summary,
  currency,
}: {
  summary: { count: number; notInProfit: bigint };
  currency: string;
}) {
  const parts = [summary.count === 1 ? "תנועה אחת" : `${String(summary.count)} תנועות`];
  if (summary.notInProfit > 0n) parts.push(`${formatAmountText(summary.notInProfit, currency)} לא נספרים ברווח`);
  return <p className="t-line2 ui-lines-count">{parts.join(" • ")}</p>;
}

/**
 * FLOW-965: the order chips are one choice, a radio group: arrow keys move the choice and the focus, and only the
 * chosen chip is a tab stop (the segmented control's pattern).
 */
export function LinesOrderChips<T extends string>({ value, options, onChange }: { value: T; options: ReadonlyArray<{ value: T; label: string }>; onChange: (next: T) => void }) {
  // The arrows are the shared radiogroup's (FLOW-966); Home and End jump to the first and the last order.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Home" && event.key !== "End") {
      onRadioArrow(event);
      return;
    }
    const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const target = event.key === "Home" ? radios[0] : radios.at(-1);
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.click();
  }
  return (
    <div className="ui-lines-chips" role="radiogroup" aria-label="סדר" onKeyDown={onKeyDown}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ui-chip ui-chip-choice"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => { onChange(option.value); }}
        >
          <span className="ui-chip-label" data-clip-ok="">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
