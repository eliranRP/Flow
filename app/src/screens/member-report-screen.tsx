import "../ui/lazy.css";
import { applyBp, computeMemberShare, formatMoney, type MemberReportConfig, type MemberShareResult, type PropertyShare } from "@flow/shared";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCompanyCurrency } from "../company-currency";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { Amount } from "../ui/amount";
import { BackButton } from "../ui/back";
import { Button } from "../ui/button";
import { formatDisplay, israelToday } from "../ui/date-math";
import { FocusTitle } from "../ui/focus-title";
import { ChevronDownIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";
import { useToast } from "../ui/toast";
import { TopBand } from "../ui/top-band";
import {
  useMemberReport,
  useMemberReportWrite,
  useRefreshTreasury,
  useSellingCostWrite,
  type MemberReportPatch,
  type MemberReportRead,
  type RefreshAnswer,
} from "../use-member-report";
import {
  DRILL_KEYS,
  MISSING_WORDS,
  bpText,
  memberIndex,
  modeOf,
  ppmText,
  quoteRateText,
  refiFormula,
  saleFormula,
  spreadText,
  verdictText,
  type DrillKey,
  type ReportMode,
  type Share,
} from "./member-report-format";
import { DrillSheet, TreasuryUpdated } from "./member-report-parts";
import { AssumptionsSheet, MemberPickSheet, MembersSheet, PropertySheet, QuoteSheet, YieldsSheet, spreadOptions } from "./member-report-sheets";
import { CalcSection, FormulaList, type Resolve } from "./project-returns-parts";
import { PERCENT_KINDS, PercentSheet, type PercentKind } from "./project-returns-sheets";

/* ------------------------------------------------------------------------------------------------
 * FLOW-1118 (decision 0263, concept A approved 2026-11-09): דוח שותף. A member's share if the company sells
 * every property, or after a refinance, with the lender quotes against the Treasury yield plus the spread.
 * ---------------------------------------------------------------------------------------------- */

type SheetName = "members" | "pick" | "quote" | "yields" | "assumptions";

/** FLOW-1121: the selling cost's editor, of the report's value (the investment page's is of the ARV). */
const SELLING_KIND: PercentKind = {
  ...PERCENT_KINDS.selling,
  help: "תיווך, עלויות סגירה ומסים במכירה, באחוזים מהשווי. בלי ערך משלו, 8%. נשמר בנכס, כמו בעמוד ההשקעה שלו.",
  layer: "member-selling",
};

const SAMPLE_REFRESH = (): Promise<RefreshAnswer> => Promise.resolve({ requested: true });

function isDrillKey(value: string): value is DrillKey {
  return (DRILL_KEYS as readonly string[]).includes(value);
}

/** A sample's selling cost changed the way set_project_investment does (stories). */
function withSelling(read: MemberReportRead, projectIds: readonly string[], bp: number | null): MemberReportRead {
  return { ...read, properties: read.properties.map((p) => (projectIds.includes(p.project_id) ? { ...p, selling_cost_bp: bp } : p)) };
}

/** A patch applied to a sample's setting, the way set_member_report merges it (stories). */
export function applyPatch(config: MemberReportConfig | null, patch: MemberReportPatch): MemberReportConfig {
  const merged: Record<string, unknown> = { ...config, ...patch };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => value != null));
}

function heroMeta(mode: ReportMode, r: MemberShareResult, currency: string) {
  if (mode === "sell") return "אם מוכרים הכל · אחרי עלויות המכירה וסילוק ההלוואות";
  if (r.totals.refinancedCount === 0) return "אף נכס לא משחרר כסף בריפייננס";
  return (
    <>
      {"במזומן, והנכסים נשארים"}
      {r.totals.paymentMinor == null ? null : <>{" · תשלום "}<Amount agorot={r.totals.paymentMinor} currency={currency} />{" לחודש"}</>}
    </>
  );
}

export function MemberReportScreen({ sample, refreshSample }: {
  sample?: MemberReportRead;
  /** Stories: what refresh_treasury_yields answers (with a sample, "requested" when left out). */
  refreshSample?: () => Promise<RefreshAnswer>;
} = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const preview = useHomePreview();
  const backSearch = usePreviewSearch();
  const live = sample == null;
  const query = useMemberReport(live);
  const [sampled, setSampled] = useState<MemberReportRead | undefined>(sample);
  const data = live ? query.data : sampled;
  const write = useMemberReportWrite();
  const [sheet, setSheet] = useState<SheetName | null>(null);
  const [property, setProperty] = useState<PropertyShare | null>(null);
  // FLOW-1121: the row of החישוב opened, and the selling cost being edited (a property's id, or "all").
  const [drill, setDrill] = useState<DrillKey | null>(null);
  const [selling, setSelling] = useState<string | null>(null);
  const sellingWrite = useSellingCostWrite();
  const treasury = useRefreshTreasury(live ? undefined : (refreshSample ?? SAMPLE_REFRESH));
  const phase = live ? screenPhase(preview, query) : { kind: "ready" as const };

  const result = useMemo(() => (data == null ? null : computeMemberShare(data.config, data.properties, data.treasuryYields)), [data]);
  const mode = modeOf(location.search);
  const index = memberIndex(location.search, result?.members.length ?? 0);
  const member = result?.members[index] ?? null;
  const share: Share = member == null ? null : { name: member.name, ownershipBp: member.ownershipBp };

  const setParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(location.search);
    if (value == null) params.delete(key);
    else params.set(key, value);
    const text = params.toString();
    void navigate({ pathname: location.pathname, search: text === "" ? "" : `?${text}` }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  const save = useCallback(async (patch: MemberReportPatch): Promise<boolean> => {
    if (!live) {
      setSampled((current) => (current == null ? current : { ...current, config: applyPatch(current.config, patch) }));
      return true;
    }
    try {
      await write.mutateAsync(patch);
      return true;
    } catch {
      return false;
    }
  }, [live, write]);

  const saveSelling = useCallback(async (projectIds: readonly string[], bp: number | null): Promise<boolean> => {
    if (!live) {
      setSampled((current) => (current == null ? current : withSelling(current, projectIds, bp)));
      return true;
    }
    try {
      await sellingWrite.mutateAsync({ projectIds, bp });
      return true;
    } catch {
      return false;
    }
  }, [live, sellingWrite]);

  // A selling cost saved here can be taken back, as on the investment page (DESIGN-RULES 0030): each property's
  // percent before (null while it took the default) is kept, and ביטול puts every one back. The properties are
  // written one by one; when one fails, the ones already written are put back and the write's own toast says so.
  const toast = useToast();
  const saveSellingWithUndo = useCallback(async (ids: readonly string[], bp: number | null): Promise<boolean> => {
    const before = (result?.properties ?? [])
      .filter((p) => ids.includes(p.projectId))
      .map((p) => [p.projectId, p.sellingCostDefault ? null : p.sellingCostBp] as const);
    const written: (typeof before)[number][] = [];
    for (const entry of before) {
      if (!(await saveSelling([entry[0]], bp))) {
        for (const [id, prior] of written) await saveSelling([id], prior);
        return false;
      }
      written.push(entry);
    }
    toast.show({
      message: "עלויות המכירה עודכנו",
      action: "ביטול",
      onAction: () => { void (async () => { for (const [id, prior] of before) await saveSelling([id], prior); })(); },
    });
    return true;
  }, [result, saveSelling, toast]);

  const canEdit = data?.canEdit === true;
  const config = data?.config ?? {};
  const companyCurrency = useCompanyCurrency();
  const currency = result?.currency ?? companyCurrency;
  const updated = (
    <TreasuryUpdated fetchedAt={data?.treasuryFetchedAt} busy={treasury.busy} onRefresh={canEdit ? () => { void treasury.refresh(); } : undefined} />
  );

  const back = `/reports${backSearch}`;
  if (result == null) {
    return <ScreenState title="דוח שותף" kicker="דוחות" backTo={back} phase={phase.kind === "ready" ? { kind: "loading" } : phase} onRetry={() => { void query.refetch(); }} />;
  }
  // Every row of החישוב opens its parts (FLOW-1121).
  const resolve: Resolve = (target) => {
    if (target.kind !== "sheet" || !isDrillKey(target.sheet)) return null;
    const key = target.sheet;
    return { onClick: () => { setDrill(key); } };
  };
  // The selling cost being edited: one property's own percent (null while it takes the default), or every
  // property's when they share one.
  const sellingIds = selling == null ? [] : selling === "all" ? result.properties.map((p) => p.projectId) : [selling];
  const sellingShown = result.properties.filter((p) => sellingIds.includes(p.projectId));
  const sellingBp = sellingShown.length > 0 && sellingShown.every((p) => !p.sellingCostDefault && p.sellingCostBp === sellingShown[0]?.sellingCostBp)
    ? (sellingShown[0]?.sellingCostBp ?? null) : null;
  const memberMinor = member == null ? null : mode === "sell" ? member.saleMinor : member.refinanceMinor;
  const whole = mode === "sell" ? result.totals.saleNetMinor : result.totals.cashOutMinor;
  const figure = memberMinor ?? whole;
  // The chip: the owner with one member edits the members; with two or more, or a viewer, it picks one.
  const pickOnly = !canEdit || result.members.length > 1;
  const chip = member == null ? undefined : (
    <button type="button" className="ui-band-company ui-msr-chip m-press" aria-haspopup="dialog"
      aria-label={`השותף: ${member.name}, ${bpText(member.ownershipBp)}. ${pickOnly ? "החלפה" : "עריכת שותפים"}`}
      onClick={() => { setSheet(pickOnly ? "pick" : "members"); }}>
      <span className="ui-msr-chip-name" dir="auto" data-clip-ok="">{`${member.name} · ${bpText(member.ownershipBp)}`}</span>
      <ChevronDownIcon size={16} />
    </button>
  );
  return (
    <div className="ui-msr-page">
      <TopBand
        wordmark={false}
        leading={<BackButton fallback={back} text="דוחות" onBand />}
        trailing={chip}
        heroClassName="ui-msr-hero"
        hero={(
          <>
            <FocusTitle className="ui-band-label ui-msr-band-label">{heroLabel(mode, member?.name ?? null)}</FocusTitle>
            <p className="ui-msr-band-figure ui-band-fade"><Amount agorot={figure} currency={currency} loss={figure < 0n} size="hero" /></p>
            <p className="ui-msr-band-sub t-meta ui-band-fade">{heroMeta(mode, result, currency)}</p>
          </>
        )}
      >
        <div className="ui-msr-band-tabs">
          <SegmentedControl label="תרחיש" showLabel={false} role="tab" tone="band" value={mode} onChange={(next) => { setParam("mode", next === "refi" ? "refi" : null); }}
            options={[{ value: "sell", label: "מכירת הכל" }, { value: "refi", label: "ריפייננס" }]} />
        </div>
      </TopBand>
      <div className="ui-rep-content ui-msr">
        {result.ownershipSet ? null : (
          <section className="ui-msr-empty" aria-label="לפני הגדרת שותפים">
            <h2 className="t-title-3">מי מחזיק כמה?</h2>
            <p>{"כדי לראות את החלק של כל שותף, הגדירו את אחוזי הבעלות לפי הסכם ההפעלה. עד אז מוצג הסכום של החברה כולה."}</p>
            {canEdit ? <Button onClick={() => { setSheet("members"); }}>הגדרת שותפים</Button> : null}
          </section>
        )}
        <CalcSection title="החישוב" total={null}>
          <FormulaList formula={mode === "sell" ? saleFormula(result, share, memberMinor) : refiFormula(result, share, memberMinor)} currency={currency} resolve={resolve} label="החישוב" />
        </CalcSection>
        {mode === "refi" ? <RateSection result={result} canEdit={canEdit} onOpen={setSheet} onSave={save} config={config} updated={updated} /> : null}
        <section className="ui-msr-props" aria-labelledby="msr-props">
          <h2 id="msr-props" className="t-section">לפי נכס</h2>
          <List>
            {result.properties.map((p) => {
              const whole = mode === "sell" ? p.saleNetMinor : p.refinances ? p.cashOutMinor : 0n;
              const own = member == null ? whole : applyBp(whole, member.ownershipBp);
              return (
                <ListRow key={p.projectId} variant="project" title={p.name} agorot={own} currency={currency} loss={own < 0n}
                  hint={mode === "sell" ? `שווי ${formatMoney(p.valueMinor, currency)} · הלוואה ${formatMoney(p.loanBalanceMinor, currency)}` : p.refinances ? `הלוואה חדשה ${formatMoney(p.newLoanMinor, currency)}` : "לא משתלם למחזר"}
                  onClick={() => { setProperty(p); }} />
              );
            })}
          </List>
          {result.missing.length === 0 ? null : (
            <p className="ui-msr-note">{`לא בחישוב: ${result.missing.map((m) => `${m.name} (${MISSING_WORDS[m.reason]})`).join(", ")}.`}</p>
          )}
        </section>
        {canEdit ? <Button variant="link" onClick={() => { setSheet("assumptions"); }}>הנחות החישוב</Button> : null}
        <p className="ui-rep-note">
          {mode === "sell"
            ? "השווי מההערכה האחרונה של כל נכס. לפני מס; רואה החשבון קובע את המס על הרווח."
            : `הלוואה ל־${String(result.assumptions.termYears)} שנה, ${bpText(result.assumptions.ltvBp)} מהשווי, ${bpText(result.assumptions.closingBp)} עלויות סגירה. לפני מס.`}
        </p>
      </div>
      <MemberPickSheet open={sheet === "pick"} onOpenChange={(open) => { setSheet(open ? "pick" : null); }} members={result.members} index={index}
        onPick={(next) => { setParam("member", next === 0 ? null : String(next)); }}
        onEdit={canEdit ? () => { setSheet("members"); } : undefined} />
      <MembersSheet open={sheet === "members"} onOpenChange={(open) => { setSheet(open ? "members" : null); }} onSave={save} members={config.members ?? []} />
      <QuoteSheet open={sheet === "quote"} onOpenChange={(open) => { setSheet(open ? "quote" : null); }} onSave={save}
        quotes={config.quotes ?? []} quoteDate={result.rate.quoteDate} expectedPpm={result.rate.expectedPpm}
        properties={result.properties.map((p) => ({ projectId: p.projectId, name: p.name }))} />
      <YieldsSheet open={sheet === "yields"} onOpenChange={(open) => { setSheet(open ? "yields" : null); }} onSave={save} config={config} result={result} updated={updated} />
      <AssumptionsSheet open={sheet === "assumptions"} onOpenChange={(open) => { setSheet(open ? "assumptions" : null); }} onSave={save} result={result} />
      <DrillSheet drill={drill} mode={mode} onOpenChange={(open) => { if (!open) setDrill(null); }} result={result} currency={currency} search={backSearch}
        onEditSelling={canEdit ? (id) => { setDrill(null); setSelling(id ?? "all"); } : undefined} />
      <PercentSheet
        kind={{ ...SELLING_KIND, title: selling === "all" ? "עלויות מכירה · כל הנכסים" : `עלויות מכירה · ${sellingShown[0]?.name ?? ""}` }}
        open={selling != null}
        onOpenChange={(open) => { if (!open) setSelling(null); }}
        bp={sellingBp}
        onSave={(bp) => saveSellingWithUndo(sellingIds, bp)}
      />
      <PropertySheet open={property != null} onOpenChange={(open) => { if (!open) setProperty(null); }} property={property} result={result} member={share} mode={mode} currency={currency} />
    </div>
  );
}

/** The band's label: whose figure it is, and which way. */
function heroLabel(mode: ReportMode, name: string | null): string {
  if (name == null) return mode === "sell" ? "הון נקי של החברה אם מוכרים הכל" : "כסף שמשתחרר בריפייננס";
  return mode === "sell" ? `החלק של ${name} אם מוכרים הכל` : `החלק של ${name} מריפייננס`;
}

const YIELDS_AUTO = "תשואות האג״ח מתעדכנות אוטומטית מאתר משרד האוצר.";

/** ריבית צפויה מול ההצעות: the quotes' date, the rule (5/10 years, +1.5/+2.0), the expected rate, the quotes. */
function RateSection({ result, canEdit, onOpen, onSave, config, updated }: {
  result: MemberShareResult;
  canEdit: boolean;
  onOpen: (sheet: SheetName) => void;
  onSave: (patch: MemberReportPatch) => Promise<boolean>;
  config: MemberReportConfig;
  /** When the Treasury's yields were last fetched, and the owner's רענון (FLOW-1121). */
  updated: ReactNode;
}) {
  const rate = result.rate;
  const toast = useToast();
  // A quote is removed at once, with ביטול that saves the list before (DESIGN-RULES 0030's undo toast).
  const remove = async (id: string, lender: string) => {
    const before = config.quotes ?? [];
    if (!(await onSave({ quotes: before.filter((x) => x.id !== id) }))) return;
    toast.show({ message: `ההצעה של ${lender} הוסרה`, action: "ביטול", onAction: () => { void onSave({ quotes: before }); } });
  };
  const rule = (tenor: 5 | 10, spread: number) => { void onSave({ rate_rule: { tenor_years: tenor, spread_bp: spread } }); };
  // With no quote and no yield yet, the date is today's: the yields sheet opens on it.
  const date = formatDisplay(rate.quoteDate ?? israelToday());
  return (
    <CalcSection title="ריבית צפויה מול ההצעות" total={rate.expectedPpm == null ? null : <bdi dir="ltr" className="ui-num">{ppmText(rate.expectedPpm)}</bdi>}>
      <div className="ui-msr-rate">
        <div className="ui-msr-rate-line">
          <span className="t-muted">תאריך ההצעות</span>
          {canEdit ? (
            <Button variant="secondary" onClick={() => { onOpen("yields"); }}>{date}</Button>
          ) : <span>{date}</span>}
        </div>
        <SegmentedControl label="אג״ח ארה״ב" value={String(rate.tenorYears)} disabled={!canEdit}
          options={[{ value: "5", label: "5 שנים" }, { value: "10", label: "10 שנים" }]}
          onChange={(next) => { rule(next === "5" ? 5 : 10, rate.spreadBp); }} />
        <SegmentedControl label="מרווח" value={String(rate.spreadBp)} disabled={!canEdit}
          options={spreadOptions(rate.spreadBp)}
          onChange={(next) => { rule(rate.tenorYears, Number(next)); }} />
        <p className="ui-msr-formula">
          {rate.yieldPpm == null
            ? (canEdit ? `${YIELDS_AUTO} אפשר גם להקליד ידנית.` : YIELDS_AUTO)
            : `אג״ח ${String(rate.tenorYears)} שנים ${ppmText(rate.yieldPpm)} ${spreadText(rate.spreadBp)}`}
        </p>
        {rate.yieldDate == null ? null : (
          <p className="ui-msr-yield-source">{`תשואה מ־${formatDisplay(rate.yieldDate)} · ${rate.yieldSource === "treasury" ? "משרד האוצר" : "הוקלד"}`}</p>
        )}
        {updated}
      </div>
      <List>
        {result.quotes.map((q) => (
          <ListRow key={q.id} variant="static" title={q.lender} hint={verdictText(q) ?? formatDisplay(q.quoted_on)}
            action={(
              <span className="ui-msr-quote-end">
                <bdi dir="ltr" className="ui-num" data-verdict={q.verdict ?? undefined}>{quoteRateText(q.rate_ppm)}</bdi>
                {canEdit ? (
                  <Button variant="danger-link" aria-label={`הסרת ההצעה של ${q.lender}`} onClick={() => { void remove(q.id, q.lender); }}>הסרה</Button>
                ) : null}
              </span>
            )} />
        ))}
      </List>
      {result.quotes.length === 0 ? <p className="ui-msr-note">{canEdit ? "עוד אין הצעות. הוסיפו הצעה כדי להשוות." : "עוד אין הצעות."}</p> : null}
      {canEdit ? <Button variant="link" onClick={() => { onOpen("quote"); }}>+ הוספת הצעה</Button> : null}
    </CalcSection>
  );
}
