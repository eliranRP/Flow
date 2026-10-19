import { useId } from "react";
import { cx } from "./cx";
import { PencilIcon } from "./icons";
// The pace sheet takes the recurring pace sheet's board rows (ui-pace-sheet).
import "./css/38-related-charges.css";
import "./css/50-forecast-edit.css";

/**
 * The ProfitNextEdit page's two own parts: the big amount field with its pencil, and the history bars (five
 * months of the category in the project, then the forecast month's dashed bar).
 */

/** The amount the forecast row takes: the sign and the currency mark sit before the typed digits, LTR. */
export function ForecastAmountField({
  value,
  onChange,
  mark,
  sign,
  income,
  label,
  inputRef,
}: {
  /** The field's text ("1,200"). */
  value: string;
  onChange: (text: string) => void;
  /** The currency's mark ("$"). */
  mark: string;
  /** "−" for an expense, "+" for income, shown once there is an amount. */
  sign: string;
  income: boolean;
  label: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <label className="ui-fe-amount" htmlFor={id}>
      <span className="ui-fe-amount-pencil" aria-hidden="true"><PencilIcon size={20} /></span>
      <span className={cx("ui-fe-amount-figure", income && "ui-fe-amount-income", value === "" && "ui-fe-amount-empty")} dir="ltr">
        <span aria-hidden="true">{value === "" ? mark : `${sign}${mark}`}</span>
        <input
          ref={inputRef}
          id={id}
          className="ui-fe-amount-input"
          aria-label={label}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          // Sized in digit widths (the app's figures are tabular, about 1ch each) plus room for the caret, not by
          // `size`: Safari's `size` takes an average character, narrower than the big digits, and clipped the last one.
          style={{ inlineSize: `calc(${String(Math.max(value.length, 1))}ch + 2px)` }}
          value={value}
          onChange={(event) => { onChange(event.target.value); }}
        />
      </span>
    </label>
  );
}

export type ForecastBar = { key: string; label: string; minor: bigint };

/**
 * The bars, oldest on the right: each month's height against the tallest (the forecast included), 4px at
 * the least; the forecast month's bar is dashed in the accent. No figures on the bars: the line above says them.
 */
export function ForecastBars({ months, forecast }: { months: readonly ForecastBar[]; forecast: ForecastBar }) {
  const top = [...months, forecast].reduce((max, bar) => (bar.minor > max ? bar.minor : max), 1n);
  const height = (minor: bigint) => Math.max(4, Math.round((Number(minor) / Number(top)) * 64));
  return (
    <div className="ui-fe-bars" aria-hidden="true">
      {[...months, forecast].map((bar) => {
        const next = bar === forecast;
        return (
          <div key={bar.key} className="ui-fe-bar-col">
            <span className={cx("ui-fe-bar", next && "ui-fe-bar-next")} style={{ blockSize: `${String(height(bar.minor))}px` }} />
            <span className={cx("ui-fe-bar-label", next && "ui-fe-bar-label-next")}>{bar.label}</span>
          </div>
        );
      })}
    </div>
  );
}
