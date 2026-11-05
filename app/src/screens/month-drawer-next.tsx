import "../ui/lazy.css";
import type { CashMonths } from "@flow/shared";
import { cashMonthName } from "../cash";
import { shiftMonthKey } from "../period";
import { usePreviewSearch } from "../preview";
import { FailureLine } from "../ui/empty-state";
import { CompanyCashCard, nothingExpected, thisMonthCashOut, useCompanyCashNextMonth, type HomeNextMonthSample } from "./company-cash-next-month";

/**
 * FLOW-1036 (BUILD-PLAN §5): next month in the month drawer, where Home's next-month card was (FLOW-990). The
 * company's dashed צפי card, read only once the drawer shows next month; Home loads it in its own chunk, so the
 * forecast's reads stay out of Home's first load. A failed read says so with a retry; nothing expected says so.
 */
export function DrawerNextMonth({ today, currency, cash, sample }: {
  /** yyyy-mm-dd. */
  today: string;
  currency: string;
  /** Home's cash months: this month's cash out, which the card's expense caption compares with. */
  cash: NonNullable<CashMonths> | null;
  /** Stories: the reads as they would come back. */
  sample?: HomeNextMonthSample;
}) {
  const search = usePreviewSearch();
  const next = useCompanyCashNextMonth(currency, today, sample == null, sample?.next);
  if (next.failed) {
    return (
      <FailureLine
        offline={next.paused}
        onRetry={() => {
          void next.refetch();
        }}
      />
    );
  }
  if (!next.loading && nothingExpected(next.forecast)) {
    const name = cashMonthName(`${shiftMonthKey(today.slice(0, 7), 1)}-01`, new Date(`${today}T12:00:00Z`));
    return <p className="ui-month-drawer-next-none t-line2">{`עוד אין צפי ל${name}`}</p>;
  }
  return <CompanyCashCard next={next} currency={currency} today={today} thisMonthOut={thisMonthCashOut(sample?.cash ?? cash, today, currency)} href={`/forecast/next${search}`} />;
}
