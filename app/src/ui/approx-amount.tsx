import { formatAmountText } from "@flow/shared";
import { cx } from "./cx";

/**
 * An expected figure, never an actual (FLOW-403): "כ־" before the whole amount, which stays LTR
 * in a `bdi`. Unsigned: the section or list it sits in says it is a cost. A zero drops "כ־".
 * Income is drawn in `income` green (decision 0120).
 */
export function ApproxAmount({
  minor,
  currency = "ILS",
  income = false,
  className,
}: {
  minor: bigint;
  currency?: string;
  income?: boolean;
  className?: string;
}) {
  const unsigned = minor < 0n ? -minor : minor;
  const text = formatAmountText(unsigned, currency);
  const zero = /^\D*0$/.test(text);
  return (
    <span className={cx("ui-approx t-amount", income && !zero && "ui-approx-income", className)}>
      {zero ? null : (
        <>
          <span className="sr-only">בערך </span>
          <span aria-hidden="true">כ־</span>
        </>
      )}
      {income && !zero ? <span className="sr-only">הכנסה </span> : null}
      <bdi dir="ltr" className="ui-num">{text}</bdi>
    </span>
  );
}

/** The words a row's accessible name uses for an expected figure. */
export function approxAmountText(minor: bigint, currency = "ILS"): string {
  const unsigned = minor < 0n ? -minor : minor;
  const text = formatAmountText(unsigned, currency);
  return /^\D*0$/.test(text) ? text : `בערך ${text}`;
}
