import "../ui/lazy.css";
import { formatMoney, type MemberProjection, type ProjectionResult, type PropertyProjection } from "@flow/shared";
import { useState, type ReactNode } from "react";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { Stepper } from "../ui/stepper";
import type { MemberReportPatch } from "../use-member-report";
import { bpText } from "./member-report-format";
import {
  FORECAST_MISSING_WORDS,
  forecastFormula,
  forecastPropertyHint,
  forecastYear,
  membersRepaid,
  propertyYearFormula,
  untilFormula,
  type ForecastDrillKey,
} from "./member-report-forecast-format";
import { ForecastAssumptionsSheet, type CostCategory } from "./member-report-forecast-sheets";
import { CalcSection, FormulaList, type Resolve } from "./project-returns-parts";

/* ------------------------------------------------------------------------------------------------
 * FLOW-1127 (FLOW-1125's mockup A, approved 2026-11-09): דוח שותף's תחזית tab. The refinance year (1 to 10), the
 * portfolio's equity and loans year by year, the refinance then and the member's part, the cash flow until then,
 * each property year by year (D), and the forecast's assumptions (C). Loaded with the tab, apart from the report.
 * ---------------------------------------------------------------------------------------------- */

const NO_LINKS: Resolve = () => null;

type Line = { key: string; title: string; hint: string; minor: bigint; muted?: boolean };

/** What one row of the forecast's החישוב is made of: per property (or per member, or per loan) and the total. */
export function forecastDrill(key: ForecastDrillKey, r: ProjectionResult): { title: string; help: string; lines: Line[]; total: bigint; rest?: Line[] } {
  const currency = r.currency ?? "USD";
  const m = (n: bigint) => formatMoney(n, currency);
  const year = forecastYear(r);
  const refinanced = r.properties.filter((p) => p.refi.refinances);
  const others = r.properties.filter((p) => !p.refi.refinances);
  const per = (pick: (p: PropertyProjection) => bigint, hint: (p: PropertyProjection) => string) => ({
    lines: refinanced.map((p) => ({ key: p.projectId, title: p.name, hint: hint(p), minor: pick(p) })),
    rest: others.map((p) => ({ key: p.projectId, title: p.name, hint: hint(p), minor: pick(p), muted: true })),
  });
  const last = (p: PropertyProjection) => p.years[p.years.length - 1];
  const share = (mm: MemberProjection) => ({ key: mm.name, title: mm.name, hint: `${bpText(mm.ownershipBp)} × ${m(r.refi.splitMinor)}`, minor: mm.cashShareMinor });
  switch (key) {
    case "loan":
      return { title: "הלוואה חדשה", help: `${bpText(r.assumptions.ltvBp)} מהשווי של כל נכס ב־${String(year)}. נספרים רק נכסים שמשחררים כסף.`, total: r.refi.newLoanMinor,
        ...per((p) => p.refi.newLoanMinor, (p) => `${bpText(r.assumptions.ltvBp)} × ${m(last(p)?.valueMinor ?? 0n)}`) };
    case "payoff":
      return { title: "סילוק הלוואות", help: `היתרה של כל הלוואה ב־${String(year)}, לפי לוח הסילוקין שלה, בלי הלוואות שותפים.`, total: r.refi.payoffMinor - r.refi.payoffMemberLoansMinor,
        ...per((p) => p.refi.payoffMinor - p.refi.memberLoansMinor, () => `יתרה ב־${String(year)}`) };
    case "closing":
      return { title: "עלויות סגירה", help: `${bpText(r.assumptions.closingBp)} מההלוואה החדשה של כל נכס.`, total: r.refi.closingMinor,
        ...per((p) => p.refi.closingMinor, (p) => `${bpText(r.assumptions.closingBp)} × ${m(p.refi.newLoanMinor)}`) };
    case "split":
      return { title: "כסף שמשתחרר לשותפים", help: "הלוואה חדשה, פחות היתרות, פחות עלויות הסגירה, לכל נכס; פחות הלוואות השותפים לחברה, שמוחזרות קודם.", total: r.refi.splitMinor,
        lines: [
          ...refinanced.map((p) => ({ key: p.projectId, title: p.name, hint: `${m(p.refi.newLoanMinor)} − ${m(p.refi.payoffMinor)} − ${m(p.refi.closingMinor)}`, minor: p.refi.cashOutMinor })),
          ...(r.refi.companyLoansRepaidMinor === 0n ? [] : [{ key: "company", title: "הלוואות שותפים לחברה", hint: "מוחזרות קודם", minor: -r.refi.companyLoansRepaidMinor }]),
        ],
        rest: others.map((p) => ({ key: p.projectId, title: p.name, hint: "לא משתלם למחזר", minor: p.refi.cashOutMinor, muted: true })) };
    case "member_loans":
      return { title: "הלוואות שותפים", help: "הלוואה ששותף נתן לחברה מוחזרת לו בריפייננס: על נכס ממוחזר מההלוואה החדשה, ושל החברה מהכסף שמשתחרר, לפני החלוקה.", total: membersRepaid(r),
        lines: r.members.filter((mm) => mm.loansBackMinor !== 0n).map((mm) => ({ key: mm.name, title: mm.name, hint: "ההלוואות שלו שמוחזרות", minor: mm.loansBackMinor })) };
    case "share":
      return { title: "החלק של כל שותף", help: "אחוז הבעלות של כל שותף כפול הכסף שמשתחרר לשותפים.", total: r.refi.splitMinor, lines: r.members.map(share) };
    case "total":
      return { title: "סה״כ לכל שותף", help: "החלק של כל שותף בכסף, ועוד ההלוואות שנתן לחברה, שמוחזרות לו.", total: r.members.reduce((s, mm) => s + mm.totalMinor, 0n),
        lines: r.members.map((mm) => ({ key: mm.name, title: mm.name, hint: `${m(mm.cashShareMinor)} + ${m(mm.loansBackMinor)}`, minor: mm.totalMinor })) };
  }
}

function ForecastDrillSheet({ drill, result, onOpenChange }: { drill: ForecastDrillKey | null; result: ProjectionResult; onOpenChange: (open: boolean) => void }) {
  const d = drill == null ? null : forecastDrill(drill, result);
  const currency = result.currency ?? "USD";
  const row = (l: Line) => <ListRow key={l.key} variant="project" title={l.title} hint={l.hint} agorot={l.minor} currency={currency} loss={l.minor < 0n} muted={l.muted} />;
  return (
    <Sheet open={drill != null} onOpenChange={onOpenChange} title={d?.title ?? ""} panelClassName="ui-sheet-wide ui-msr-sheet">
      {d == null ? null : (
        <>
          <p className="ui-msr-help">{d.help}</p>
          <List>{d.lines.map(row)}</List>
          <p className="ui-msr-drill-total"><span>סה״כ</span><Amount agorot={d.total} currency={currency} loss={d.total < 0n} /></p>
          {d.rest == null || d.rest.length === 0 ? null : (
            <section className="ui-msr-drill-rest" aria-labelledby="msr-forecast-rest">
              <h3 id="msr-forecast-rest" className="t-section">לא ממוחזרים · לא נספרים</h3>
              <List>{d.rest.map(row)}</List>
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}

/** One property year by year (D): a year, its statement, and its value, balance, equity and DSCR. */
function ForecastPropertySheet({ property, result, onOpenChange }: { property: PropertyProjection | null; result: ProjectionResult; onOpenChange: (open: boolean) => void }) {
  const [year, setYear] = useState(1);
  const currency = result.currency ?? "USD";
  const y = property?.years[Math.min(year, property.years.length) - 1];
  return (
    <Sheet open={property != null} onOpenChange={(open) => { if (!open) setYear(1); onOpenChange(open); }} title={property?.name ?? ""} panelClassName="ui-sheet-wide ui-msr-sheet">
      {property == null || y == null ? null : (
        <>
          <Stepper label={`שנה (${String(forecastYear(result, year))})`} value={year} min={1} max={property.years.length} onChange={setYear} />
          <FormulaList formula={propertyYearFormula(y, result)} currency={currency} resolve={NO_LINKS} label={`${property.name} · ${String(forecastYear(result, year))}`} />
          <dl className="ui-msr-facts">
            <div><dt>שווי</dt><dd><Amount agorot={y.valueMinor} currency={currency} /></dd></div>
            <div><dt>יתרת הלוואות</dt><dd><Amount agorot={y.balanceMinor} currency={currency} /></dd></div>
            <div><dt>הון</dt><dd><Amount agorot={y.valueMinor - y.balanceMinor} currency={currency} /></dd></div>
            <div><dt>DSCR</dt><dd><bdi dir="ltr" className="ui-num">{y.debtServiceMinor === 0n ? "—" : (Number((y.noiMinor * 1000n) / y.debtServiceMinor) / 1000).toFixed(2)}</bdi></dd></div>
          </dl>
        </>
      )}
    </Sheet>
  );
}

/** Equity over loan balances, year by year: the refinance year's bar marked. */
function ForecastBars({ result }: { result: ProjectionResult }) {
  const max = result.totals.reduce((m, t) => (t.valueMinor > m ? t.valueMinor : m), 1n);
  const pct = (n: bigint) => `${String(Number(((n > 0n ? n : 0n) * 1000n) / max) / 10)}%`;
  const year = forecastYear(result);
  return (
    <figure className="ui-msr-bars" aria-label={`ההון ויתרת ההלוואות בכל שנה עד ${String(year)}`}>
      <div className="ui-msr-bars-plot" aria-hidden="true">
        {result.totals.map((t) => (
          <div key={t.year} className="ui-msr-bar" data-on={t.year === result.years || undefined}>
            <span className="ui-msr-bar-equity" style={{ blockSize: pct(t.valueMinor - t.balanceMinor) }} />
            <span className="ui-msr-bar-loan" style={{ blockSize: pct(t.balanceMinor) }} />
          </div>
        ))}
      </div>
      <div className="ui-msr-bars-years" aria-hidden="true">
        {result.totals.map((t) => <span key={t.year} data-on={t.year === result.years || undefined}>{String(forecastYear(result, t.year)).slice(2)}</span>)}
      </div>
      <figcaption className="ui-msr-bars-legend">
        <span><i className="ui-msr-key-equity" />הון</span>
        <span><i className="ui-msr-key-loan" />יתרת הלוואות</span>
      </figcaption>
    </figure>
  );
}

export function ForecastBody({ result, member, years, onYears, canEdit, projection, onSave, costCategories }: {
  result: ProjectionResult;
  member: MemberProjection | null;
  years: number;
  onYears: (years: number) => void;
  canEdit: boolean;
  /** The setting's projection part now, for the assumptions sheet and its undo. */
  projection: Parameters<typeof ForecastAssumptionsSheet>[0]["projection"];
  onSave: (patch: MemberReportPatch) => Promise<boolean>;
  costCategories: readonly CostCategory[];
}) {
  const [drill, setDrill] = useState<ForecastDrillKey | null>(null);
  const [property, setProperty] = useState<PropertyProjection | null>(null);
  const [assumptions, setAssumptions] = useState(false);
  const currency = result.currency ?? "USD";
  const resolve: Resolve = (target) => {
    if (target.kind !== "sheet" || !target.sheet.startsWith("forecast:")) return null;
    const key = target.sheet.slice("forecast:".length) as ForecastDrillKey;
    return { onClick: () => { setDrill(key); } };
  };
  let missing: ReactNode = null;
  if (result.missing.length > 0) {
    missing = <p className="ui-msr-note">{`לא בתחזית: ${result.missing.map((m) => `${m.name} (${FORECAST_MISSING_WORDS[m.reason]})`).join(", ")}.`}</p>;
  }
  return (
    <>
      <section className="ui-msr-forecast-years" aria-label="שנת הריפייננס">
        <Stepper label={`ריפייננס בעוד (שנים) · ${String(forecastYear(result))}`} value={years} min={1} max={10} onChange={onYears} />
        <ForecastBars result={result} />
      </section>
      <CalcSection title={`ריפייננס ב־${String(forecastYear(result))}`} total={null}>
        <FormulaList formula={forecastFormula(result, member)} currency={currency} resolve={resolve} label="החישוב" />
      </CalcSection>
      <CalcSection title="עד אז" total={null}>
        <FormulaList formula={untilFormula(result, member)} currency={currency} resolve={NO_LINKS} label="עד אז" />
      </CalcSection>
      <section className="ui-msr-props" aria-labelledby="msr-forecast-props">
        <h2 id="msr-forecast-props" className="t-section">לפי נכס</h2>
        <List>
          {/* Each property's cash out (the whole, before the members' loans and the split). */}
          {result.properties.map((p) => (
            <ListRow key={p.projectId} variant="project" title={p.name} hint={forecastPropertyHint(p, result)}
              agorot={p.refi.refinances ? p.refi.cashOutMinor : 0n} currency={currency} onClick={() => { setProperty(p); }} />
          ))}
        </List>
        {missing}
      </section>
      <Button variant="link" onClick={() => { setAssumptions(true); }}>הנחות התחזית</Button>
      <p className="ui-rep-note">
        {`תחזית לפי ההנחות, לא הבטחה. שכירות ${bpText(result.assumptions.growthBp.rent)} בשנה, ערך ${bpText(result.assumptions.growthBp.appreciation)}, תחלופת דיירים כל ${String(result.assumptions.stayMonths)} חודשים. לפני מס.`}
      </p>
      <ForecastDrillSheet drill={drill} result={result} onOpenChange={(open) => { if (!open) setDrill(null); }} />
      <ForecastPropertySheet property={property} result={result} onOpenChange={(open) => { if (!open) setProperty(null); }} />
      <ForecastAssumptionsSheet open={assumptions} onOpenChange={setAssumptions} canEdit={canEdit} projection={projection} onSave={onSave} costCategories={costCategories} />
    </>
  );
}
