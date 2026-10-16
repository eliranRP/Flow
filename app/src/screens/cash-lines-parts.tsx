import { formatAmountText, type CashCurrencyRow } from "@flow/shared";
import { type CashListSide, notInProfitMinor, notInProfitRest } from "../cash";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { DocumentIcon } from "../ui/icons";
import { SegmentedControl } from "../ui/segmented-control";
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
            <Amount agorot={figure} currency={currency} size="display" income={side === "in"} />
          </span>
        </p>
      ) : null}
      {side === "kept" ? (
        <p className="ui-breakdown-hint ui-page-pad t-hint">
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

/** A lines page with no line: what is missing for this side. */
export function CashLinesEmpty({ side, rest }: { side: CashListSide; rest: bigint }) {
  return (
    <EmptyState
      icon={<DocumentIcon />}
      title={side === "in" ? "לא נכנס כסף בחודש הזה" : side === "out" ? "לא יצא כסף בחודש הזה" : rest === 0n ? "הכול נספר ברווח החודש" : "אין תנועות שמחוץ לרווח"}
      body="תנועות שנכנסות לתזרים יופיעו כאן."
    />
  );
}

/** The next page of lines, when the read has one. */
export function CashLinesMore({ busy, onMore }: { busy: boolean; onMore: () => void }) {
  return (
    <div className="ui-page-pad">
      <Button
        variant="pill"
        busy={busy}
        onClick={() => {
          onMore();
        }}
      >
        עוד תנועות
      </Button>
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
      <p className="ui-breakdown-total ui-page-pad">
        <Skeleton width="md" />
      </p>
    );
  }
  return (
    <p className="ui-breakdown-total ui-page-pad">
      <span className="ui-breakdown-total-line">
        <Amount agorot={total} currency={currency} size="display" income={side === "in"} />
      </span>
    </p>
  );
}

/** FLOW-366: "N תנועות · N ממתינות לאישור · $X לא נספרים ברווח"; the pending and out-of-profit parts show only when they apply. */
export function LinesCount({
  summary,
  currency,
}: {
  summary: { count: number; pending: number; notInProfit: bigint };
  currency: string;
}) {
  const parts = [summary.count === 1 ? "תנועה אחת" : `${String(summary.count)} תנועות`];
  if (summary.pending > 0) parts.push(`${String(summary.pending)} ממתינות לאישור`);
  if (summary.notInProfit > 0n) parts.push(`${formatAmountText(summary.notInProfit, currency)} לא נספרים ברווח`);
  return <p className="t-line2 ui-lines-count ui-page-pad">{parts.join(" · ")}</p>;
}
