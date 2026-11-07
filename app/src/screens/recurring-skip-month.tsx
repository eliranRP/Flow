import { useState } from "react";
import { forecastKeyOf, useForecastOverrides, useForecastSkip } from "../forecast-skip";
import { shiftMonthKey } from "../period";
import type { ScheduleRow } from "../recurring-schedule";
import { Button } from "../ui/button";
import { HEBREW_MONTHS } from "../ui/date-math";
import { CalendarIcon } from "../ui/icons";
import { Toggle } from "../ui/toggle";

function monthWord(key: string): string {
  return HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}

/** The forecast's reach: this month and the 12 after it (decision 0260). */
const HORIZON_MONTHS = 12;

/**
 * The month the charge is next expected in, while the forecast reaches it: this month while it is still due (soon
 * or late), else its next due month. Null once nothing is expected within the forecast.
 */
export function skipMonthOf(row: Pick<ScheduleRow, "state" | "next_due_month">, today: string): string | null {
  const current = today.slice(0, 7);
  if (row.state === "soon" || row.state === "late") return current;
  const next = row.next_due_month.slice(0, 7);
  if (next === "" || next <= current || next > shiftMonthKey(current, HORIZON_MONTHS)) return null;
  return next;
}

/**
 * FLOW-1079 (the owner's pick, concept B): on the charge's page, "לא צפוי ב<month>": a switch that takes the charge
 * out of the forecast of the month it is next expected in (this month while due, else its next one), or puts it
 * back; Home's months take any month of the forecast. A dev sample keeps it local.
 */
export function ChargeSkipMonth({ row, split, live, today, disabled, blocked }: {
  row: ScheduleRow;
  /** The party is split into charges by project (decision 0185): the forecast keys the charge by its project. */
  split: boolean;
  live: boolean;
  today: string;
  /** A viewer. */
  disabled: boolean;
  /** A preview: the write is refused with its own toast. */
  blocked: () => boolean;
}) {
  const due = skipMonthOf(row, today);
  const month = due ?? today.slice(0, 7);
  const name = monthWord(month);
  const overrides = useForecastOverrides(month, live && due != null);
  const skip = useForecastSkip(month, name, overrides.data ?? null);
  const [sampleOn, setSampleOn] = useState(false);
  if (due == null) return null;
  const key = forecastKeyOf(row, split);
  const on = live ? skip.skipped.has(key) : sampleOn;
  // FLOW-1087: the switch waits for the month's forecast, since it cannot show a state it does not know. A failed
  // read says so in the hint and offers a retry, instead of leaving the switch disabled with no reason.
  const failed = live && overrides.data == null && overrides.isError;
  const hint = failed
    ? "לא הצלחנו לטעון את הצפי."
    : on ? `לא נספר בצפי של ${name}. בשאר החודשים הוא צפוי כרגיל.` : `מוציא רק את ${name} מהצפי. שאר החודשים נשארים.`;
  return (
    <div className="ui-charge-skip">
      <Toggle
        icon={<CalendarIcon />}
        label={`לא צפוי ב${name}`}
        hint={hint}
        checked={on}
        disabled={disabled || (live && overrides.data == null)}
        busy={skip.busy}
        onChange={(out) => {
          if (live && blocked()) return;
          if (live) skip.set(key, out, row.party_name);
          else setSampleOn(out);
        }}
      />
      {failed ? (
        <div className="ui-charge-skip-retry">
          <Button variant="link" busy={overrides.isFetching} onClick={() => { void overrides.refetch(); }}>
            נסו שוב
          </Button>
        </div>
      ) : null}
    </div>
  );
}
