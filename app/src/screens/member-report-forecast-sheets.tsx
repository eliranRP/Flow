import { PROJECTION_SERIES, guessCostType, type CostType, type ProjectionConfig, type ProjectionSeries } from "@flow/shared";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { CalendarIcon } from "../ui/icons";
import { SelectField } from "../ui/select-field";
import { Sheet } from "../ui/sheet";
import { Stepper } from "../ui/stepper";
import { TextField } from "../ui/text-field";
import { useToast } from "../ui/toast";
import type { MemberReportPatch } from "../use-member-report";
import { forecastDraft, projectionFromDraft, SERIES_LABELS, withHidden, yearField, type ForecastDraft, type ForecastField } from "./member-report-forecast-format";

const BAD_VALUE = "ערך לא תקין";

/* ------------------------------------------------------------------------------------------------
 * FLOW-1127 (FLOW-1125's mockup C): the forecast's assumptions. Every value starts at its default and can be
 * changed; rent, each cost type and the appreciation can take another change in a given year; each cost
 * category takes a type. Saved as the setting's projection part, with ביטול; a viewer reads them.
 * ---------------------------------------------------------------------------------------------- */

/** A cost category of the properties' last 12 months, for its type. */
export type CostCategory = { id: string; name: string };

const TYPE_OPTIONS: { value: CostType; label: string }[] = [
  { value: "tax", label: "מס נכס" },
  { value: "insurance", label: "ביטוח" },
  { value: "hoa", label: "HOA" },
  { value: "repairs", label: "תיקונים (התחזוקה במקומם)" },
  { value: "other", label: "אחר" },
];

export function ForecastAssumptionsSheet({ open, onOpenChange, canEdit, projection, onSave, costCategories }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  projection: ProjectionConfig | undefined;
  onSave: (patch: MemberReportPatch) => Promise<boolean>;
  costCategories: readonly CostCategory[];
}) {
  const [draft, setDraft] = useState<ForecastDraft>(() => forecastDraft(projection));
  const [openSeries, setOpenSeries] = useState<ReadonlySet<ProjectionSeries>>(new Set());
  // FLOW-1148: a bad value says so under its own field once the field is left or שמירה is pressed.
  const [touched, setTouched] = useState<ReadonlySet<ForecastField>>(new Set());
  const [checked, setChecked] = useState(false);
  const fields = useRef(new Map<ForecastField, HTMLInputElement>());
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (!open) return;
    setDraft(forecastDraft(projection));
    setOpenSeries(new Set());
    setTouched(new Set());
    setChecked(false);
    // Only a new open resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const built = projectionFromDraft(draft);
  const bad: readonly ForecastField[] = "invalid" in built ? built.invalid : [];
  const errorOf = (key: ForecastField) => (bad.includes(key) && (checked || touched.has(key)) ? BAD_VALUE : undefined);
  const field = (key: ForecastField) => ({
    error: errorOf(key),
    ref: (el: HTMLInputElement | null) => { if (el) fields.current.set(key, el); else fields.current.delete(key); },
    onBlur: () => { setTouched((t) => (t.has(key) ? t : new Set(t).add(key))); },
  });
  const badYear = (s: ProjectionSeries) => bad.some((k) => k.startsWith(`year:${s}:`));
  const toggle = (s: ProjectionSeries) => {
    setOpenSeries((o) => { const next = new Set(o); if (!next.delete(s)) next.add(s); return next; });
  };
  const set = (next: Partial<ForecastDraft>) => { setDraft((d) => ({ ...d, ...next })); };
  async function save() {
    if (busy) return;
    if (!("projection" in built)) {
      // Every error shows and every series with a bad year opens, then the first bad field takes the focus.
      flushSync(() => {
        setChecked(true);
        setOpenSeries((o) => new Set([...o, ...PROJECTION_SERIES.filter(badYear)]));
      });
      const first = bad[0] == null ? undefined : fields.current.get(bad[0]);
      first?.focus({ preventScroll: true });
      if (typeof first?.scrollIntoView === "function") first.scrollIntoView({ block: "center" });
      return;
    }
    setBusy(true);
    const before = projection ?? null;
    const ok = await onSave({ projection: withHidden(projection, built.projection) });
    setBusy(false);
    if (!ok) return;
    onOpenChange(false);
    toast.show({ message: "הנחות התחזית נשמרו", action: "ביטול", onAction: () => { void onSave({ projection: before }); } });
  }
  const percent = (key: ForecastField, label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <TextField label={label} numeric inputMode="decimal" dir="ltr" value={value} hint={hint} disabled={!canEdit} {...field(key)}
      onChange={(event) => { onChange(event.target.value); }} />
  );
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!busy) onOpenChange(next); }}
      title="הנחות התחזית"
      busy={busy}
      panelClassName="ui-sheet-wide ui-msr-sheet"
      action={canEdit ? <Button full busy={busy} onClick={() => { void save(); }}>שמירה</Button> : undefined}
    >
      <p className="ui-msr-help">לכל התיק. כל ערך מתחיל בברירת מחדל; לשכירות, לכל עלות ולעליית הערך אפשר לתת שינוי אחר לשנה מסוימת, בלוח השנה שליד השדה.</p>
      <section className="ui-msr-forecast-group" aria-labelledby="msr-fa-growth">
        <h3 id="msr-fa-growth" className="t-section">שינוי בכל שנה (%)</h3>
        {PROJECTION_SERIES.map((s) => (
          <div key={s} className="ui-msr-forecast-series">
            <div className="ui-msr-forecast-series-row">
              {percent(`growth:${s}`, SERIES_LABELS[s], draft.growth[s], (v) => { set({ growth: { ...draft.growth, [s]: v } }); })}
              {/* A year with its own change: the calendar opens the years; marked while open or while a year differs. */}
              <IconButton
                label={`${SERIES_LABELS[s]}: שינוי שונה לשנה מסוימת${draft.byYear[s].some((v) => v.trim() !== "") ? " · יש שנים שונות" : ""}${badYear(s) ? ` · ${BAD_VALUE}` : ""}`}
                className="ui-msr-forecast-years-toggle"
                aria-expanded={openSeries.has(s)}
                aria-controls={`msr-fa-years-${s}`}
                data-on={openSeries.has(s) || draft.byYear[s].some((v) => v.trim() !== "") ? "" : undefined}
                onClick={() => { toggle(s); }}
              >
                <CalendarIcon />
              </IconButton>
            </div>
            {openSeries.has(s) ? (
              <div id={`msr-fa-years-${s}`} className="ui-msr-forecast-years-grid">
                {draft.byYear[s].map((v, i) => (
                  <TextField key={i} label={`שנה ${String(i + 1)}`} numeric inputMode="decimal" dir="ltr" value={v} placeholder={draft.growth[s]} disabled={!canEdit}
                    {...field(yearField(s, i + 1))}
                    onChange={(event) => { set({ byYear: { ...draft.byYear, [s]: draft.byYear[s].map((x, j) => (j === i ? event.target.value : x)) } }); }} />
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </section>
      <section className="ui-msr-forecast-group" aria-labelledby="msr-fa-rent">
        <h3 id="msr-fa-rent" className="t-section">מהשכירות, כל שנה (%)</h3>
        {percent("maintenance", "תחזוקה", draft.maintenance, (v) => { set({ maintenance: v }); }, "תיקונים שוטפים")}
        {percent("capex", "רזרבה ל־CapEx", draft.capex, (v) => { set({ capex: v }); }, "גג, מערכות, מכשירים")}
      </section>
      <section className="ui-msr-forecast-group" aria-labelledby="msr-fa-turn">
        <h3 id="msr-fa-turn" className="t-section">תחלופת דיירים</h3>
        <Stepper label="דייר נשאר בממוצע (חודשים)" value={draft.stayMonths} min={1} max={120} disabled={!canEdit} onChange={(v) => { set({ stayMonths: v }); }} />
        {percent("emptyMonths", "חודשים ריקים בכל תחלופה", draft.emptyMonths, (v) => { set({ emptyMonths: v }); })}
        {percent("turnoverCost", "עלות תחלופה ($ ליחידה)", draft.turnoverCost, (v) => { set({ turnoverCost: v }); }, "ניקיון, צבע, פרסום")}
      </section>
      <section className="ui-msr-forecast-group" aria-labelledby="msr-fa-refi">
        <h3 id="msr-fa-refi" className="t-section">הריפייננס</h3>
        {percent("rate", "ריבית (%)", draft.rate, (v) => { set({ rate: v }); }, "ריק: הריבית הצפויה היום, לא תחזית")}
        <p className="ui-msr-help">אחוז המימון, עלויות הסגירה והתקופה הם של הנחות הריפייננס בדוח.</p>
      </section>
      {costCategories.length === 0 ? null : (
        <section className="ui-msr-forecast-group" aria-labelledby="msr-fa-types">
          <h3 id="msr-fa-types" className="t-section">סוג כל עלות</h3>
          {costCategories.map((c) => (
            <SelectField key={c.id} label={c.name} value={draft.categoryTypes[c.id] ?? guessCostType(c.name)} disabled={!canEdit}
              options={TYPE_OPTIONS}
              onChange={(event) => { set({ categoryTypes: { ...draft.categoryTypes, [c.id]: event.target.value } }); }} />
          ))}
        </section>
      )}
      {canEdit ? <Button variant="link" onClick={() => { setDraft(forecastDraft(undefined)); }}>חזרה לברירות המחדל</Button> : null}
    </Sheet>
  );
}
