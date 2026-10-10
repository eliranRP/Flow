import { Link } from "react-router-dom";
import { ApproxAmount, approxAmountText } from "./approx-amount";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { HintParts } from "./hint-parts";
import { CheckIcon, ChevronIcon } from "./icons";
import { List } from "./list-row";
import type { ScreenPhase } from "./screen-phase";
import { ListSkeleton } from "./skeleton";

export type MissingBillRow = {
  id: string;
  name: string;
  /** FLOW-415: "project · category", or null when the bill files to neither. */
  place: string | null;
  /** FLOW-415: "בדרך כלל ב־2 לחודש · אחרון 02/09". */
  usual: string;
  /** The typical amount, unsigned. */
  minor: bigint;
  currency: string;
  /** Search, filtered to the supplier. */
  href: string;
};

/**
 * The late bills (FLOW-403, plan option A2): one row per recurring supplier, its name, and one "כ־"
 * amount. FLOW-415 (layout A): two hint lines, where the bill files ("project · category") and when it
 * usually comes ("בדרך כלל ב־N לחודש · אחרון dd/mm"). A tap opens Search on that supplier. No approve, no dismiss:
 * a row leaves by itself when the bill comes in.
 */
export function MissingBillList({
  rows,
  phase = { kind: "ready" },
  onRetry,
}: {
  rows: readonly MissingBillRow[];
  phase?: ScreenPhase;
  onRetry?: () => void;
}) {
  if (phase.kind === "loading") return <ListSkeleton />;
  if (phase.kind === "error") return <ErrorState offline={phase.offline} onRetry={() => { onRetry?.(); }} />;
  if (phase.kind === "empty" || rows.length === 0) {
    return <EmptyState icon={<CheckIcon />} title="הכל הגיע" body="אין חשבונות שמאחרים החודש." />;
  }
  return (
    <List className="ui-missing-bills">
      {rows.map((row) => (
        <Link
          key={row.id}
          to={row.href}
          className="ui-row ui-hit"
          aria-label={[row.name, row.place, row.usual, approxAmountText(row.minor, row.currency)].filter((part) => part != null).join(", ")}
        >
          <span className="ui-row-main">
            <span className="ui-row-text">
              <span className="ui-row-title">{row.name}</span>
              {row.place != null ? <span className="ui-row-hint">{row.place}</span> : null}
              <span className="ui-row-hint"><HintParts text={row.usual} /></span>
            </span>
          </span>
          <ApproxAmount minor={row.minor} currency={row.currency} />
          <span className="ui-row-chevron" aria-hidden="true">
            <ChevronIcon />
          </span>
        </Link>
      ))}
    </List>
  );
}
