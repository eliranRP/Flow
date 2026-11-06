import { formatAmountText, type ForecastOverrideRow } from "@flow/shared";
import { useForecastSkip } from "../forecast-skip";
import type { NextMonthForecast } from "../project-next-month";
import { Button } from "../ui/button";
import { HEBREW_MONTHS } from "../ui/date-math";

/** The override a skipped row came from: its party's moved-out item for the month (with or without its project). */
export function overrideKeyFor(rowKey: string, overrides: readonly ForecastOverrideRow[]): string | null {
  const [kind, direction, party] = rowKey.split(":");
  if (kind !== "rec" || direction == null || party == null) return null;
  return overrides.find((row) => row.moved_out && row.item_key.startsWith(`party:${direction}:${party}:`))?.item_key ?? null;
}

/**
 * FLOW-1079: on a project's צפי page, the charges taken out of this month only (from Home or the charge's page):
 * "לא צפוי ב<month>", each with החזרה, which puts the month forecast's item back (not the project page's own
 * restore, which is for its removals). A row put back leaves at once; the next read draws it in the forecast.
 */
export function ProjectNextSkipped({ forecast, overrides, currency, disabled }: {
  forecast: NextMonthForecast;
  overrides: readonly ForecastOverrideRow[] | null;
  currency: string;
  disabled: boolean;
}) {
  const name = HEBREW_MONTHS[Number(forecast.month.slice(5, 7)) - 1] ?? forecast.month;
  const skip = useForecastSkip(forecast.month, name, overrides);
  const rows = (forecast.skipped ?? []).flatMap((row) => {
    const key = overrideKeyFor(row.key, overrides ?? []);
    return key != null && !skip.skipped.has(key) ? [] : [{ row, key }];
  });
  if (rows.length === 0) return null;
  return (
    <section className="ui-pn-off" aria-labelledby="pn-skip-title">
      <h2 id="pn-skip-title" className="ui-pn-off-title">{`לא צפוי ב${name} · ${String(rows.length)}`}</h2>
      {rows.map(({ row, key }) => (
        <div key={row.key} className="ui-pn-off-row">
          <span className="ui-pn-off-text">
            <span className="ui-pn-off-name">{row.name}</span>
            <span className="ui-pn-off-meta">
              <bdi dir="ltr">{formatAmountText(row.minor < 0n ? -row.minor : row.minor, currency)}</bdi>
              {` · הוצא מהצפי של ${name} בלבד`}
            </span>
          </span>
          <Button
            variant="link"
            aria-label={`החזרה לצפי: ${row.name}`}
            disabled={disabled || key == null || skip.busy}
            onClick={() => { if (key != null) skip.set(key, false, row.name); }}
          >
            החזרה
          </Button>
        </div>
      ))}
    </section>
  );
}
