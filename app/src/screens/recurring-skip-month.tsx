import { useState } from "react";
import { forecastKeyOf, useForecastSkip } from "../forecast-skip";
import { useMonthForecastQuery } from "../month-forecast-query";
import { shiftMonthKey } from "../period";
import type { ScheduleRow } from "../recurring-schedule";
import { HEBREW_MONTHS } from "../ui/date-math";
import { CalendarIcon } from "../ui/icons";
import { Toggle } from "../ui/toggle";

function monthWord(key: string): string {
  return HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}

/**
 * FLOW-1079 (the owner's pick, concept B): on the charge's page, "לא צפוי ב<month>": a switch that takes the charge
 * out of this month's forecast, or puts it back. Only while the charge is still expected this month (soon or late);
 * once it arrived, or when it is due in a later month, there is nothing to take out. A dev sample keeps it local.
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
  const month = today.slice(0, 7);
  const name = monthWord(month);
  const expected = row.state === "soon" || row.state === "late";
  const forecast = useMonthForecastQuery(month, live && expected);
  const skip = useForecastSkip(month, name, forecast.data?.overrides ?? null);
  const [sampleOn, setSampleOn] = useState(false);
  if (!expected) return null;
  const key = forecastKeyOf(row, split);
  const on = live ? skip.skipped.has(key) : sampleOn;
  const next = monthWord(shiftMonthKey(month, 1));
  return (
    <div className="ui-charge-skip">
      <Toggle
        icon={<CalendarIcon />}
        label={`לא צפוי ב${name}`}
        hint={on ? `לא נספר בצפי של ${name}. ב${next} הוא צפוי שוב.` : `מוציא רק את ${name} מהצפי. ${next} נשאר כרגיל.`}
        checked={on}
        disabled={disabled || (live && forecast.data == null)}
        busy={skip.busy}
        onChange={(out) => {
          if (live && blocked()) return;
          if (live) skip.set(key, out, row.party_name);
          else setSampleOn(out);
        }}
      />
    </div>
  );
}
