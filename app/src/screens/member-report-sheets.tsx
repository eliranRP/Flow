import type { LoanType, MemberReportConfig, MemberReportQuote, MemberShareResult, PropertyShare } from "@flow/shared";
import { useEffect, useState } from "react";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { israelToday } from "../ui/date-math";
import { List, ListRow } from "../ui/list-row";
import { SegmentedControl } from "../ui/segmented-control";
import { SelectField } from "../ui/select-field";
import { Sheet } from "../ui/sheet";
import { Stepper } from "../ui/stepper";
import { TextField } from "../ui/text-field";
import type { MemberReportPatch } from "../use-member-report";
import {
  bpText,
  ppmText,
  propertyRefiFormula,
  propertySaleFormula,
  spreadText,
  type ReportMode,
  type Share,
} from "./member-report-format";
import { FormulaList } from "./project-returns-parts";

/* ------------------------------------------------------------------------------------------------
 * FLOW-1118: the member share report's sheets. Each saves one part of the setting (set_member_report)
 * on שמירה; a viewer sees none of them but the property's.
 * ---------------------------------------------------------------------------------------------- */

type SaveProps = { open: boolean; onOpenChange: (open: boolean) => void; onSave: (patch: MemberReportPatch) => Promise<boolean> };

const NO_LINKS = () => null;

/** "6.125" → 61250 ppm; null when it is not a percent with up to `places` decimals in [0, max]. */
export function percentToUnits(raw: string, places: number, scale: number, max: number): number | null {
  const clean = raw.trim();
  if (!new RegExp(`^\\d{1,3}(\\.\\d{1,${String(places)}})?$`).test(clean)) return null;
  const units = Math.round(Number(clean) * scale);
  return units <= max ? units : null;
}

function unitsToRaw(units: number | null | undefined, scale: number): string {
  return units == null ? "" : String(Number((units / scale).toFixed(4)));
}

/* Members ------------------------------------------------------------------------------------- */

/** A member as typed: the name, and the ownership as a percent with up to two decimals ("33.33"). */
type DraftMember = { name: string; percent: string };

const OWNERSHIP_WHOLE = 10_000;

/** A member's typed ownership in basis points; null when it is not 0 to 100 with up to two decimals. */
function ownershipBp(percent: string): number | null {
  return percentToUnits(percent, 2, 100, OWNERSHIP_WHOLE);
}

/** The stored members as the sheet's draft, in their exact basis points (3334 → "33.34"). */
export function membersDraft(members: NonNullable<MemberReportConfig["members"]>): DraftMember[] {
  if (members.length === 0) return [{ name: "", percent: "50" }, { name: "", percent: "50" }];
  return members.map((m) => ({ name: m.name, percent: unitsToRaw(m.ownership_bp, 100) }));
}

/** The draft as set_member_report's members; call only when membersProblem is null. */
export function draftMembers(draft: readonly DraftMember[]): NonNullable<MemberReportConfig["members"]> {
  return draft.map((m) => ({ name: m.name.trim(), ownership_bp: ownershipBp(m.percent) ?? 0 }));
}

/** The draft's total in basis points, a percent typed wrong counting as none. */
export function draftTotalBp(draft: readonly DraftMember[]): number {
  return draft.reduce((sum, m) => sum + (ownershipBp(m.percent) ?? 0), 0);
}

/** The members' draft is saveable: names given and unique, each percent valid, and exactly 10000 basis points. */
export function membersProblem(draft: readonly DraftMember[]): string | null {
  if (draft.length === 0) return null;
  if (draft.some((m) => m.name.trim() === "")) return "לכל שותף צריך שם.";
  if (new Set(draft.map((m) => m.name.trim().toLowerCase())).size !== draft.length) return "שני שותפים באותו שם.";
  if (draft.some((m) => ownershipBp(m.percent) == null)) return "בעלות היא בין 0 ל־100%, עד שתי ספרות אחרי הנקודה.";
  const total = draftTotalBp(draft);
  if (total !== OWNERSHIP_WHOLE) return total < OWNERSHIP_WHOLE ? `חסרים ${bpText(OWNERSHIP_WHOLE - total)} עד 100%.` : `עודף של ${bpText(total - OWNERSHIP_WHOLE)} מעל 100%.`;
  return null;
}

export function MembersSheet({ open, onOpenChange, onSave, members }: SaveProps & { members: NonNullable<MemberReportConfig["members"]> }) {
  const [draft, setDraft] = useState<DraftMember[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDraft(membersDraft(members));
    // Only a new open resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const total = draftTotalBp(draft);
  const problem = membersProblem(draft);
  const set = (index: number, next: Partial<DraftMember>) => { setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...next } : row))); };
  async function save() {
    if (busy || problem != null) return;
    setBusy(true);
    const ok = await onSave({ members: draftMembers(draft) });
    setBusy(false);
    if (ok) onOpenChange(false);
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!busy) onOpenChange(next); }}
      title="שותפים ואחוזי בעלות"
      busy={busy}
      panelClassName="ui-sheet-wide ui-msr-sheet"
      action={<Button full busy={busy} disabled={problem != null} onClick={() => { void save(); }}>שמירה</Button>}
    >
      <p className="ui-msr-help">לפי הסכם ההפעלה של החברה. האחוזים חלים על כל הנכסים.</p>
      <ul className="ui-msr-members" aria-label="שותפים">
        {draft.map((member, index) => (
          <li key={index} className="ui-msr-member">
            <TextField label={`שותף ${String(index + 1)}`} value={member.name} maxLength={60} onChange={(event) => { set(index, { name: event.target.value }); }} />
            <TextField label="בעלות (%)" numeric inputMode="decimal" dir="ltr" value={member.percent} placeholder="50"
              onChange={(event) => { set(index, { percent: event.target.value }); }} />
            {draft.length > 1 ? (
              <Button variant="danger-link" onClick={() => { setDraft((rows) => rows.filter((_, i) => i !== index)); }}>הסרה</Button>
            ) : null}
          </li>
        ))}
      </ul>
      {draft.length < 20 ? <Button variant="link" onClick={() => { setDraft((rows) => [...rows, { name: "", percent: "0" }]); }}>+ הוספת שותף</Button> : null}
      <p className="ui-msr-total" data-ok={problem == null || undefined} role="status">
        <span>סה״כ</span>
        <bdi dir="ltr" className="ui-num">{bpText(total)}</bdi>
      </p>
      {problem == null ? null : <p className="ui-msr-problem">{problem}</p>}
    </Sheet>
  );
}

/** The band's chip when there are two or more members, or for a viewer: whose share the report shows. */
export function MemberPickSheet({ open, onOpenChange, members, index, onPick, onEdit }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: MemberShareResult["members"];
  index: number;
  onPick: (index: number) => void;
  /** The owner's way to the members sheet; absent for a viewer. */
  onEdit?: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="השותף בדוח" panelClassName="ui-sheet-wide ui-msr-sheet">
      <List>
        {members.map((m, i) => (
          <ListRow key={m.name} variant="selectable" title={m.name} hint={bpText(m.ownershipBp)} selected={i === index}
            onSelect={() => { onPick(i); onOpenChange(false); }} />
        ))}
      </List>
      {onEdit == null ? null : <Button variant="link" onClick={onEdit}>עריכת שותפים ואחוזים</Button>}
    </Sheet>
  );
}

/* A lender quote ------------------------------------------------------------------------------ */

const LOAN_TYPES: { value: LoanType; label: string }[] = [
  { value: "fixed", label: "קבועה" },
  { value: "arm", label: "ARM" },
  { value: "dscr", label: "DSCR" },
];

export function QuoteSheet({ open, onOpenChange, onSave, quotes, quoteDate, expectedPpm, properties }: SaveProps & {
  quotes: readonly MemberReportQuote[];
  quoteDate: string | null;
  expectedPpm: number | null;
  properties: readonly { projectId: string; name: string }[];
}) {
  const [lender, setLender] = useState("");
  const [rate, setRate] = useState("");
  const [points, setPoints] = useState("");
  const [date, setDate] = useState("");
  const [project, setProject] = useState("");
  const [type, setType] = useState<LoanType>("fixed");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLender(""); setRate(""); setPoints(""); setProject(""); setType("fixed");
    setDate(quoteDate ?? israelToday());
    // Only a new open resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ratePpm = percentToUnits(rate, 3, 10_000, 300_000);
  const pointsBp = points.trim() === "" ? 0 : percentToUnits(points, 2, 100, 1000);
  const ready = lender.trim() !== "" && ratePpm != null && ratePpm > 0 && pointsBp != null && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const diff = ratePpm == null || expectedPpm == null ? null : ratePpm - expectedPpm;
  async function save() {
    if (busy || !ready) return;
    setBusy(true);
    const quote: MemberReportQuote = {
      id: crypto.randomUUID(),
      lender: lender.trim(),
      rate_ppm: ratePpm,
      points_bp: pointsBp,
      quoted_on: date,
      loan_type: type,
      project_id: project === "" ? null : project,
    };
    const ok = await onSave({ quotes: [...quotes, quote] });
    setBusy(false);
    if (ok) onOpenChange(false);
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!busy) onOpenChange(next); }}
      title="הצעה ממלווה"
      busy={busy}
      panelClassName="ui-sheet-wide ui-msr-sheet"
      action={<Button full busy={busy} disabled={!ready} onClick={() => { void save(); }}>שמירת ההצעה</Button>}
    >
      <TextField label="מלווה" value={lender} maxLength={80} onChange={(event) => { setLender(event.target.value); }} />
      <div className="ui-msr-pair">
        <TextField label="ריבית (%)" numeric inputMode="decimal" dir="ltr" value={rate} placeholder="6.25" onChange={(event) => { setRate(event.target.value); }} />
        <TextField label="נקודות" numeric inputMode="decimal" dir="ltr" value={points} placeholder="0" onChange={(event) => { setPoints(event.target.value); }} />
      </div>
      <div className="ui-msr-pair">
        <TextField label="תאריך ההצעה" type="date" dir="ltr" value={date} onChange={(event) => { setDate(event.target.value); }} />
        <SelectField label="נכס" value={project} onChange={(event) => { setProject(event.target.value); }}
          options={[{ value: "", label: "כל הנכסים" }, ...properties.map((p) => ({ value: p.projectId, label: p.name }))]} />
      </div>
      <SegmentedControl label="סוג" value={type} options={LOAN_TYPES} onChange={setType} />
      {diff == null || expectedPpm == null ? null : (
        <p className="ui-msr-verdict" data-verdict={diff <= 0 ? "good" : diff <= 2500 ? "near" : "high"} role="status">
          <span>{`צפוי ${ppmText(expectedPpm)}`}</span>
          <span>{diff <= 0 ? `מתחת לצפוי ב־${ppmText(-diff)} · הצעה טובה` : `מעל הצפוי ב־${ppmText(diff)}`}</span>
        </p>
      )}
    </Sheet>
  );
}

/* The Treasury yields of the quote date and the spread ------------------------------------- */

/** +1.5 and +2.0 as on the board, and the spread the setting holds when it is another one (MCP takes 0 to 1000). */
export function spreadOptions(current: number): { value: string; label: string; numeric: true }[] {
  const values = current === 150 || current === 200 ? [150, 200] : [150, 200, current].sort((a, b) => a - b);
  return values.map((bp) => ({ value: String(bp), label: bp === 150 ? "+1.5" : bp === 200 ? "+2.0" : spreadText(bp), numeric: true }));
}

export function YieldsSheet({ open, onOpenChange, onSave, config, result }: SaveProps & { config: MemberReportConfig; result: MemberShareResult }) {
  const date = result.rate.quoteDate ?? israelToday();
  const yields = config.yields ?? [];
  const today = yields.find((y) => y.on_date === date);
  const [y5, setY5] = useState("");
  const [y10, setY10] = useState("");
  const [tenor, setTenor] = useState<"5" | "10">("10");
  const [spread, setSpread] = useState("150");
  const [busy, setBusy] = useState(false);
  const storedTenor = String(result.rate.tenorYears);
  const storedSpread = String(result.rate.spreadBp);
  useEffect(() => {
    if (!open) return;
    setY5(unitsToRaw(today?.y5_ppm, 10_000));
    setY10(unitsToRaw(today?.y10_ppm, 10_000));
    setTenor(storedTenor as "5" | "10");
    // A spread set elsewhere stays as it is unless the owner picks another.
    setSpread(storedSpread);
    // Only a new open resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const p5 = y5.trim() === "" ? null : percentToUnits(y5, 3, 10_000, 200_000);
  const p10 = y10.trim() === "" ? null : percentToUnits(y10, 3, 10_000, 200_000);
  const bad = (y5.trim() !== "" && p5 == null) || (y10.trim() !== "" && p10 == null);
  const chosen = tenor === "5" ? p5 : p10;
  async function save() {
    if (busy || bad) return;
    setBusy(true);
    const rest = yields.filter((y) => y.on_date !== date);
    const entry = p5 == null && p10 == null ? [] : [{ on_date: date, y5_ppm: p5, y10_ppm: p10, source: "manual" as const }];
    // The rule is sent only when the owner changed it.
    const ruleChanged = tenor !== storedTenor || spread !== storedSpread;
    const ok = await onSave({
      yields: [...rest, ...entry],
      ...(ruleChanged ? { rate_rule: { tenor_years: tenor === "5" ? 5 : 10, spread_bp: Number(spread) } } : {}),
      quote_date: date,
    });
    setBusy(false);
    if (ok) onOpenChange(false);
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!busy) onOpenChange(next); }}
      title="תשואות אג״ח ארה״ב"
      subtitle={`ליום ${date.split("-").reverse().join("/")}`}
      busy={busy}
      panelClassName="ui-sheet-wide ui-msr-sheet"
      action={<Button full busy={busy} disabled={bad} onClick={() => { void save(); }}>שמירה</Button>}
    >
      <p className="ui-msr-help">מתוך עקום התשואות היומי של משרד האוצר האמריקאי, לסגירת היום. בסוף שבוע, יום המסחר הקודם.</p>
      <div className="ui-msr-pair">
        <TextField label="5 שנים (%)" numeric inputMode="decimal" dir="ltr" value={y5} placeholder="4.12" onChange={(event) => { setY5(event.target.value); }} />
        <TextField label="10 שנים (%)" numeric inputMode="decimal" dir="ltr" value={y10} placeholder="4.38" onChange={(event) => { setY10(event.target.value); }} />
      </div>
      <SegmentedControl label="אג״ח" value={tenor} options={[{ value: "5", label: "5 שנים" }, { value: "10", label: "10 שנים" }]} onChange={setTenor} />
      <SegmentedControl label="מרווח" value={spread} options={spreadOptions(Number(storedSpread))} onChange={setSpread} />
      {chosen == null ? null : (
        <p className="ui-msr-verdict" role="status">
          <span>{`אג״ח ${tenor} שנים ${ppmText(chosen)} ${spreadText(Number(spread))} =`}</span>
          <bdi dir="ltr" className="ui-num">{ppmText(chosen + Number(spread) * 100)}</bdi>
        </p>
      )}
    </Sheet>
  );
}

/* The assumptions ------------------------------------------------------------------------------ */

export function AssumptionsSheet({ open, onOpenChange, onSave, result }: SaveProps & { result: MemberShareResult }) {
  const [ltv, setLtv] = useState("");
  const [closing, setClosing] = useState("");
  const [term, setTerm] = useState(30);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLtv(unitsToRaw(result.assumptions.ltvBp, 100));
    setClosing(unitsToRaw(result.assumptions.closingBp, 100));
    setTerm(result.assumptions.termYears);
    // Only a new open resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ltvBp = percentToUnits(ltv, 2, 100, 10_000);
  const closingBp = percentToUnits(closing, 2, 100, 2_000);
  async function save() {
    if (busy || ltvBp == null || closingBp == null) return;
    setBusy(true);
    const ok = await onSave({ assumptions: { ltv_bp: ltvBp, closing_bp: closingBp, term_years: term } });
    setBusy(false);
    if (ok) onOpenChange(false);
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!busy) onOpenChange(next); }}
      title="הנחות החישוב"
      busy={busy}
      panelClassName="ui-sheet-wide ui-msr-sheet"
      action={<Button full busy={busy} disabled={ltvBp == null || closingBp == null} onClick={() => { void save(); }}>שמירה</Button>}
    >
      <p className="ui-msr-help">משותפות לכל השותפים. עלויות המכירה והשווי נערכים בעמוד הנכס.</p>
      <TextField label="אחוז מימון (LTV)" numeric inputMode="decimal" dir="ltr" value={ltv} error={ltvBp == null ? "בין 0 ל־100%." : undefined} reserveMessage onChange={(event) => { setLtv(event.target.value); }} />
      <TextField label="עלויות סגירה (% מההלוואה)" numeric inputMode="decimal" dir="ltr" value={closing} error={closingBp == null ? "בין 0 ל־20%." : undefined} reserveMessage onChange={(event) => { setClosing(event.target.value); }} />
      <Stepper label="תקופת ההלוואה (שנים)" value={term} min={1} max={40} onChange={setTerm} />
    </Sheet>
  );
}

/* One property ---------------------------------------------------------------------------------- */

export function PropertySheet({ open, onOpenChange, property, result, member, mode: startMode, currency }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property: PropertyShare | null;
  result: MemberShareResult;
  member: Share;
  mode: ReportMode;
  /** The report's currency, else the company's. */
  currency: string;
}) {
  const [mode, setMode] = useState<ReportMode>(startMode);
  useEffect(() => { if (open) setMode(startMode); }, [open, startMode]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={property?.name ?? ""} panelClassName="ui-sheet-wide ui-msr-sheet">
      {property == null ? null : (
        <>
          <SegmentedControl label="תרחיש" showLabel={false} role="tab" value={mode} onChange={setMode}
            options={[{ value: "sell", label: "מכירה" }, { value: "refi", label: "ריפייננס" }]} />
          <FormulaList
            formula={mode === "sell" ? propertySaleFormula(property, member) : propertyRefiFormula(property, result, member)}
            currency={currency}
            resolve={NO_LINKS}
            label={property.name}
          />
          {mode === "refi" && property.paymentMinor != null && result.rate.paymentPpm != null ? (
            <p className="ui-msr-help">
              {`תשלום חודשי חדש בריבית ${ppmText(result.rate.paymentPpm)} ל־${String(result.assumptions.termYears)} שנה: `}
              <Amount agorot={property.paymentMinor} currency={currency} />
            </p>
          ) : null}
          {mode === "sell" ? <p className="ui-msr-help">{`עלויות המכירה ${bpText(property.sellingCostBp)}, מהגדרות הנכס. לפני מס.`}</p> : null}
        </>
      )}
    </Sheet>
  );
}

