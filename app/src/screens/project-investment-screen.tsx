import "../ui/lazy.css";
import type { ProjectDetail } from "@flow/shared";
import { useCallback, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { quickNewPath } from "../open-from-query";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useProjectPeriod } from "../project-period";
import { screenPhase } from "../query-phase";
import { useProjectQuery } from "../use-books";
import { useCompanyCurrency } from "../company-currency";
import { sheetStack, useSheetHistory } from "../ui/back";
import { israelToday } from "../ui/date-math";
import { INVESTMENT_LABELS, type InvestmentField, type InvestmentFigures } from "../ui/investment-card";
import { ScreenState } from "../ui/screen-state";
import { useToast } from "../ui/toast";
import { useHoldWrites } from "../use-is-viewer";
import { assertNoError, useWrite, type WriteFailure } from "../use-write";
import { projectStateLine } from "./project-detail-screen";
import { FiguresCard, LoansCard, type InvestmentRowRefs, type PropertyExtras } from "./project-investment-cards";
import {
  toProjectInvestment,
  useRehabCategoriesQuery,
  useRehabCostsQuery,
  type ProjectInvestment,
  type RehabCategory,
} from "./project-investment-data";
import { InvestmentEditSheet, RehabSheet, type InvestmentPatch } from "./project-investment-sheets";
import { MetricsCard, ReturnsCardsFailed, ReturnsCardsSkeleton, TotalReturnCard } from "./project-returns-cards";
import { usePropertyReturnsQuery, type PropertyReturns } from "./project-returns-data";
import type { EditField, InfoKey } from "./project-returns-info";
import { editFieldOf, investmentBase, pageResolver, type Resolve } from "./project-returns-parts";
import { ReturnInfoSheet, TaxBracketSheet } from "./project-returns-sheets";

export type { InvestmentPatch } from "./project-investment-sheets";

type SaveRequest = { patch: InvestmentPatch; field: InvestmentField };

export const INVESTMENT_REFUSED = "אין הרשאה לשנות את ההשקעה.";

/** The toast names the figure that failed, whichever sheet is open by then. */
export function investmentFailure(error: Error): WriteFailure {
  const field = (error as { field?: InvestmentField }).field;
  const code = (error as { code?: string }).code;
  if (code === "42501") return { message: INVESTMENT_REFUSED, retry: false };
  return `לא הצלחנו לשמור את ${field == null ? "ההשקעה" : INVESTMENT_LABELS[field]}.`;
}

/** Sample mode works the figures out the way the server does (0143). */
export function applySample(figures: InvestmentFigures, patch: InvestmentPatch): InvestmentFigures {
  const next: InvestmentFigures = { ...figures };
  if ("purchase_minor" in patch) next.purchaseMinor = patch.purchase_minor == null ? null : BigInt(patch.purchase_minor);
  if ("arv_minor" in patch) next.arvMinor = patch.arv_minor == null ? null : BigInt(patch.arv_minor);
  if ("value_minor" in patch) next.valueMinor = patch.value_minor == null ? null : BigInt(patch.value_minor);
  if ("value_date" in patch) next.valueDate = patch.value_date ?? null;
  next.forcedEquityMinor = next.arvMinor != null && next.purchaseMinor != null && next.rehabOther.length === 0
    ? next.arvMinor - next.purchaseMinor - next.rehabMinor
    : null;
  next.currentEquityMinor = next.valueMinor != null && next.loanOther.length === 0 ? next.valueMinor - next.loanMinor : null;
  return next;
}

/** Sample mode keeps the returns' inputs in step with a save (the figures they work out stay as they were). */
export function applyReturnsSample(returns: PropertyReturns, patch: InvestmentPatch): PropertyReturns {
  const inputs = { ...returns.inputs };
  const big = (value: number | null | undefined) => (value == null ? null : BigInt(value));
  if ("purchase_minor" in patch) {
    // A purchase from the lines stays; the typed price stands in only when there are none.
    inputs.purchaseTypedMinor = big(patch.purchase_minor);
    if (inputs.purchaseSource !== "lines") {
      inputs.purchaseMinor = inputs.purchaseTypedMinor;
      inputs.purchaseSource = inputs.purchaseMinor == null ? null : "typed";
    }
  }
  if ("arv_minor" in patch) inputs.arvMinor = big(patch.arv_minor);
  if ("value_minor" in patch) inputs.valueMinor = big(patch.value_minor);
  if ("land_minor" in patch) inputs.landMinor = big(patch.land_minor);
  if ("units" in patch) {
    // Cleared, units go back to the default 1 (decision 0246).
    inputs.units = patch.units ?? 1;
    inputs.unitsDefault = patch.units == null;
  }
  const missing = returns.missing.filter((input) => !(
    (input === "purchase" && inputs.purchaseMinor != null)
    || (input === "value" && inputs.valueMinor != null)
    || (input === "land" && inputs.landMinor != null)
  ));
  return { ...returns, inputs, missing };
}

/** The patch that puts a figure back as it was (a missing figure goes back to null). */
function restorePatch(field: InvestmentField, before: InvestmentFigures, extras: PropertyExtras | null): InvestmentPatch {
  const toNumber = (value: bigint | null) => (value == null ? null : Number(value));
  if (field === "purchase") return { purchase_minor: toNumber(before.purchaseMinor) };
  if (field === "arv") return { arv_minor: toNumber(before.arvMinor) };
  if (field === "land") return { land_minor: toNumber(extras?.landMinor ?? null) };
  if (field === "units") return { units: extras == null || extras.unitsDefault ? null : extras.units };
  return { value_minor: toNumber(before.valueMinor), value_date: before.valueMinor == null ? null : before.valueDate };
}

type OpenSheet = InvestmentField | "rehab" | "tax" | null;

const REHAB_LAYER = "investment-rehab";
const INFO_LAYER = "investment-info-";
const INVESTMENT_FIELDS: readonly string[] = ["purchase", "arv", "value", "land", "units"];

function isInvestmentField(value: unknown): value is InvestmentField {
  return typeof value === "string" && INVESTMENT_FIELDS.includes(value);
}

/** The ⓘ sheet that was open under a page it opened, from the history entry Back lands on. */
function infoFromHistory(state: unknown): InfoKey | null {
  const layer = sheetStack(state).find((name) => name.startsWith(INFO_LAYER));
  return layer == null ? null : (layer.slice(INFO_LAYER.length) as InfoKey);
}

export const TAX_REFUSED = "רק בעל העסק יכול לשנות את מדרגת המס.";

/** The figures of a project with no investment read: its loans only (an overhead project, an older payload). */
function loansOnly(currency: string, data: ProjectInvestment): InvestmentFigures {
  const own = data.loans.filter((loan) => loan.currency === currency && loan.status === "open");
  return {
    currency,
    purchaseMinor: null,
    arvMinor: null,
    valueMinor: null,
    valueDate: null,
    rehabMinor: 0n,
    rehabOther: [],
    loanMinor: own.reduce((sum, loan) => sum + loan.balance_minor, 0n),
    loanOther: [],
    forcedEquityMinor: null,
    currentEquityMinor: null,
  };
}

/**
 * FLOW-446 (board Invest), FLOW-451 (board ConceptATotalReturn): a project's investment and loans, its
 * own page under the project. The year's total return and its sources, the equity in the property, the
 * metrics (each figure's ⓘ opens its sheet), the property's figures (each opens its edit sheet, rehab
 * opens its breakdown) and the loans. A viewer reads it; nothing opens for a write. `sample` draws it
 * with no network (stories, dev route).
 */
export function ProjectInvestmentScreen({
  sample,
  sampleInvestment,
  sampleCategories,
  sampleReturns,
  initialSheet = null,
  initialInfo = null,
  backTo,
  base: baseProp,
  today = israelToday(),
}: {
  sample?: NonNullable<ProjectDetail>;
  sampleInvestment?: ProjectInvestment;
  sampleCategories?: RehabCategory[];
  sampleReturns?: PropertyReturns;
  /** Stories open a sheet on first draw. */
  initialSheet?: OpenSheet;
  initialInfo?: InfoKey | null;
  /** Dev fixtures send Back here. Production goes to the project page. */
  backTo?: string;
  /** Dev fixtures' path for the returns pages. Production: /projects/:id/investment. */
  base?: string;
  /** Stories pin the day the next payment is worked out from. */
  today?: string;
}) {
  const { projectId: routeId = "" } = useParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const readOnly = useHoldWrites();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const companyCurrency = useCompanyCurrency();
  const [period] = useProjectPeriod();
  const detail = useProjectQuery(sample ? "" : routeId, period);
  const project = sample ?? detail.data ?? null;
  const projectId = project?.id ?? routeId;
  const base = baseProp ?? investmentBase(projectId);
  const sampled = sampleInvestment != null;
  const [sampleData, setSampleData] = useState(sampleInvestment);
  const [sampleRet, setSampleRet] = useState(sampleReturns);
  const data = sampleData ?? (project == null ? null : toProjectInvestment(project));
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const hasFigures = data != null && !data.isOverhead && data.figures != null;
  const returnsRead = usePropertyReturnsQuery(projectId, !sampled && hasFigures);
  const returns = sampled ? (sampleRet ?? null) : (returnsRead.data ?? null);

  // `?edit=land` (a part's or a metric's page) opens that figure's sheet on arrival.
  const linked = editFieldOf(new URLSearchParams(location.search).get("edit"));
  // Back from a category's lines lands on the rehab sheet's own history entry: open it again there.
  const [sheet, setSheet] = useState<OpenSheet>(() => {
    if (readOnly) return null;
    if (initialSheet != null) return initialSheet;
    if (linked != null) return linked === "tax_bracket" ? "tax" : linked;
    return sheetStack(location.state).includes(REHAB_LAYER) ? "rehab" : null;
  });
  const [editField, setEditField] = useState<InvestmentField>(isInvestmentField(sheet) ? sheet : "purchase");
  // Back from a page an ⓘ sheet opened lands on the sheet's entry: open it again there.
  const [info, setInfo] = useState<InfoKey | null>(() => initialInfo ?? infoFromHistory(location.state));
  const [infoKey, setInfoKey] = useState<InfoKey>(info ?? "cash_flow");
  const infoOpener = useRef<HTMLElement | null>(null);
  const rows: InvestmentRowRefs = {
    purchase: useRef<HTMLButtonElement>(null),
    arv: useRef<HTMLButtonElement>(null),
    value: useRef<HTMLButtonElement>(null),
    land: useRef<HTMLButtonElement>(null),
    units: useRef<HTMLButtonElement>(null),
    rehab: useRef<HTMLButtonElement>(null),
  };
  const rehabOpen = sheet === "rehab";
  const costs = useRehabCostsQuery(projectId, rehabOpen && !sampled);
  const categories = useRehabCategoriesQuery(rehabOpen && !sampled);
  const setRehabSheet = useSheetHistory(REHAB_LAYER, rehabOpen, (next) => { setSheet(next ? "rehab" : null); });
  const setInfoSheet = useSheetHistory(`${INFO_LAYER}${infoKey}`, info != null, (next) => { setInfo(next ? infoKey : null); });

  const save = useWrite<SaveRequest>({
    failure: investmentFailure,
    keys: ["project"],
    run: async ({ patch, field }) => {
      try {
        const supabase = getSupabase();
        if (!supabase || projectId === "") throw new Error("supabase");
        assertNoError(await supabase.rpc("set_project_investment", { p_project_id: projectId, p_patch: patch }));
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error("failed"), { field });
      }
    },
  });
  const saveBracket = useWrite<number | null>({
    failure: (error) => ((error as { code?: string }).code === "42501" ? { message: TAX_REFUSED, retry: false } : "לא הצלחנו לשמור את מדרגת המס."),
    keys: ["project"],
    run: async (bp) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_tax_bracket", { p_bp: bp as number }));
    },
  });
  const figuresRef = useRef<InvestmentFigures | null>(null);
  const extrasRef = useRef<PropertyExtras | null>(null);
  const bracketRef = useRef<number | null>(null);
  const commit = useCallback(async (patch: InvestmentPatch, field: InvestmentField): Promise<boolean> => {
    if (sampled) {
      setSampleData((current) => current == null || current.figures == null ? current : { ...current, figures: applySample(current.figures, patch) });
      setSampleRet((current) => (current == null ? current : applyReturnsSample(current, patch)));
      return true;
    }
    try {
      await save.mutateAsync({ patch, field });
      return true;
    } catch {
      return false;
    }
  }, [sampled, save]);
  const onSave = useCallback(async (patch: InvestmentPatch, kind: "save" | "clear", field: InvestmentField): Promise<boolean> => {
    const before = figuresRef.current;
    const extras = extrasRef.current;
    if (!(await commit(patch, field))) return false;
    // The undo puts the figure back as it was; it is a second save, so nothing in the database changes shape.
    if (before != null) {
      toast.show({
        message: `${INVESTMENT_LABELS[field]} ${kind === "clear" ? "נמחק" : "עודכן"}`,
        action: "ביטול",
        onAction: () => { void commit(restorePatch(field, before, extras), field); },
      });
    }
    return true;
  }, [commit, toast]);
  const commitBracket = useCallback(async (bp: number | null): Promise<boolean> => {
    if (sampled) {
      setSampleRet((current) => (current == null ? current : {
        ...current,
        inputs: { ...current.inputs, taxBracketBp: bp },
        missing: bp == null ? current.missing : current.missing.filter((input) => input !== "tax_bracket"),
      }));
      return true;
    }
    try {
      await saveBracket.mutateAsync(bp);
      return true;
    } catch {
      return false;
    }
  }, [sampled, saveBracket]);
  const onSaveBracket = useCallback(async (bp: number | null): Promise<boolean> => {
    const before = bracketRef.current;
    if (!(await commitBracket(bp))) return false;
    toast.show({
      message: bp == null ? "מדרגת המס נמחקה" : "מדרגת המס עודכנה",
      action: "ביטול",
      onAction: () => { void commitBracket(before); },
    });
    return true;
  }, [commitBracket, toast]);

  const currency = data?.figures?.currency ?? data?.loans[0]?.currency ?? companyCurrency;
  const figures = data == null ? null : (hasFigures ? data.figures : loansOnly(currency, data));
  const extras: PropertyExtras | null = returns == null ? null : {
    landMinor: returns.inputs.landMinor,
    units: returns.inputs.units,
    unitsDefault: returns.inputs.unitsDefault,
    purchaseMinor: returns.inputs.purchaseMinor,
    purchaseSource: returns.inputs.purchaseSource,
    takenOverMinor: returns.inputs.takenOverMinor,
  };
  figuresRef.current = hasFigures ? figures : null;
  extrasRef.current = extras;
  bracketRef.current = returns?.inputs.taxBracketBp ?? null;
  const editMinor = figures == null ? null
    : editField === "purchase" ? figures.purchaseMinor
    : editField === "arv" ? figures.arvMinor
    : editField === "value" ? figures.valueMinor
    : editField === "land" ? (extras?.landMinor ?? null)
    : (extras == null ? null : BigInt(extras.units));
  const rehabCosts = sampled ? (sampleData?.categories ?? []) : (costs.data ?? []);
  const rehabCategories = sampled ? (sampleCategories ?? []) : (categories.data ?? null);
  const openEdit = (field: EditField) => {
    if (field === "tax_bracket") {
      setSheet("tax");
      return;
    }
    setEditField(field);
    setSheet(field);
  };
  const links = pageResolver(base, search);
  const resolve: Resolve = (target) => (target.kind === "edit" ? { onClick: () => { openEdit(target.field); } } : links(target));
  const onInfo = (key: InfoKey, opener: HTMLElement) => {
    infoOpener.current = opener;
    setInfoKey(key);
    setInfo(key);
  };
  const onAdd = readOnly ? undefined : openEdit;
  const name = project?.name;
  const stateLine = project == null ? null : projectStateLine(project);

  return (
    <ScreenState
      title="השקעה והלוואות"
      kicker={name}
      subtitle={stateLine ?? undefined}
      backTo={backTo ?? `/projects/${projectId}${search}`}
      headerClassName="ui-pinv-head"
      phase={phase}
      onRetry={() => { void detail.refetch(); }}
    >
      {figures == null || data == null ? null : (
        <div className="ui-pinv-stack">
          {hasFigures ? (
            <>
              {/* FLOW-459 (the owner's pick, 2026-11-02): the total with the equity, the inputs, then the metrics. */}
              {returns != null ? (
                <TotalReturnCard returns={returns} base={base} search={search} onInfo={onInfo} onAdd={onAdd} />
              ) : returnsRead.isError ? (
                <ReturnsCardsFailed offline={returnsRead.isPaused} onRetry={() => { void returnsRead.refetch(); }} />
              ) : <ReturnsCardsSkeleton />}
              <FiguresCard
                figures={figures}
                extras={extras}
                readOnly={readOnly}
                rows={rows}
                linesHref={`${base}/returns/acquisition${search}`}
                onEdit={openEdit}
                onRehab={() => { setRehabSheet(true); }}
              />
              {returns == null ? null : <MetricsCard returns={returns} base={base} search={search} onInfo={onInfo} onAdd={onAdd} />}
            </>
          ) : null}
          <LoansCard
            figures={figures}
            loans={data.loans}
            today={today}
            search={search}
            onAdd={readOnly ? undefined : () => {
              // The loans tab's new-loan sheet, with this project set (FLOW-139d).
              void navigate(quickNewPath("/loans", search, "loan"), { state: { newLoanProject: projectId } });
            }}
          />
          {returns == null || !hasFigures ? null : (
            <ReturnInfoSheet
              infoKey={infoKey}
              open={info != null}
              onOpenChange={setInfoSheet}
              returns={returns}
              resolve={resolve}
              readOnly={readOnly}
              returnFocusRef={infoOpener}
            />
          )}
          {readOnly || !hasFigures ? null : (
            <>
              <InvestmentEditSheet
                key={editField}
                field={editField}
                open={sheet === editField}
                onOpenChange={(next) => { setSheet(next ? editField : null); }}
                minor={editMinor}
                date={figures.valueDate}
                returnFocusRef={rows[editField]}
                onSave={onSave}
              />
              <TaxBracketSheet
                open={sheet === "tax"}
                onOpenChange={(next) => { setSheet(next ? "tax" : null); }}
                bp={returns?.inputs.taxBracketBp ?? null}
                onSave={onSaveBracket}
              />
              <RehabSheet
                projectId={projectId}
                open={rehabOpen}
                onOpenChange={setRehabSheet}
                figures={figures}
                costs={rehabCosts}
                categories={rehabCategories}
                loading={!sampled && (costs.isPending || categories.isPending)}
                failed={!sampled && (costs.isError || categories.isError)}
                onRetry={() => {
                  if (costs.isError) void costs.refetch();
                  if (categories.isError) void categories.refetch();
                }}
                returnFocusRef={rows.rehab}
              />
            </>
          )}
        </div>
      )}
    </ScreenState>
  );
}
