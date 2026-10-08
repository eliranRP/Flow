import { ApproxAmount, approxAmountText } from "./approx-amount";
import { ChevronIcon } from "./icons";
import { SectionHead } from "./layout";
import { List } from "./list-row";
import type { ScreenPhase } from "./screen-phase";
import { ListSkeleton } from "./skeleton";
import { TextLink } from "./text-link";

export type ExpectedPartyRow = {
  id: string;
  name: string;
  direction: "income" | "expense";
  currency: string;
  /** Unsigned. */
  minor: bigint;
};

export type ExpectedMonthRow = {
  month: string;
  /** "שאר אוקטובר", "נובמבר". */
  label: string;
  open: boolean;
  /** The expected expense per currency, unsigned. A second line only with a second currency. */
  figures: { currency: string; minor: bigint }[];
  parties: ExpectedPartyRow[];
};

/**
 * The project's "צפוי" section (FLOW-403, plan option A3): one row per month, one "כ־" figure,
 * the expected expense. Never added to the band or the profit. A month with parties opens its
 * sheet; one with none is a plain row. No history yet: one line.
 */
export function ExpectedMonths({
  months,
  phase = { kind: "ready" },
  onOpen,
  onRetry,
}: {
  months: readonly ExpectedMonthRow[];
  phase?: ScreenPhase;
  onOpen?: (month: ExpectedMonthRow) => void;
  onRetry?: () => void;
}) {
  return (
    <section className="ui-expected" aria-label="צפוי">
      <SectionHead title="צפוי" />
      {phase.kind === "loading" ? <ListSkeleton /> : null}
      {phase.kind === "error" ? (
        <p className="ui-page-pad t-hint ui-expected-error" role="status">
          לא הצלחנו לטעון את הצפי.{" "}
          <TextLink onClick={() => { onRetry?.(); }} size="hint" chevron={false}>ניסיון חוזר</TextLink>
        </p>
      ) : null}
      {phase.kind === "empty" || (phase.kind === "ready" && months.length === 0) ? (
        <p className="ui-page-pad t-hint">אין עדיין צפי.</p>
      ) : null}
      {phase.kind === "ready" && months.length > 0 ? (
        <List className="ui-expected-list">
          {months.map((month) => {
            const linked = month.parties.length > 0 && onOpen != null;
            const name = `${month.label}, ${month.figures.map((figure) => approxAmountText(figure.minor, figure.currency)).join(", ")}`;
            const body = (
              <>
                <span className="ui-row-main">
                  <span className="ui-row-text">
                    <span className="ui-row-title">{month.label}</span>
                  </span>
                </span>
                <span className="ui-expected-figures">
                  {month.figures.map((figure) => (
                    <ApproxAmount key={figure.currency} minor={figure.minor} currency={figure.currency} />
                  ))}
                </span>
                {linked ? (
                  <span className="ui-row-chevron" aria-hidden="true">
                    <ChevronIcon />
                  </span>
                ) : null}
              </>
            );
            return linked ? (
              <button
                key={month.month}
                type="button"
                className="ui-row ui-hit"
                aria-label={name}
                aria-haspopup="dialog"
                onClick={() => { onOpen(month); }}
              >
                {body}
              </button>
            ) : (
              <div key={month.month} className="ui-row" role="group" aria-label={name}>
                {body}
              </div>
            );
          })}
        </List>
      ) : null}
    </section>
  );
}
