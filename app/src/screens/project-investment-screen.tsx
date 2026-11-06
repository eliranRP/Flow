import "../ui/lazy.css";
import type { ProjectDetail } from "@flow/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { quickNewPath } from "../open-from-query";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useProjectPeriod } from "../project-period";
import { screenPhase } from "../query-phase";
import { useProjectQuery } from "../use-books";
import { useCompanyCurrency } from "../company-currency";
import { AttentionCards } from "../ui/attention-cards";
import { BackButton, sheetStack, useSheetHistory } from "../ui/back";
import { BandLoadFailed, BandOfflineLine, useOnline } from "../ui/band-states";
import { CompactBar } from "../ui/compact-bar";
import { israelToday } from "../ui/date-math";
import { DockSlot, useDockedFilter } from "../ui/dock-filter";
import { EmptyState } from "../ui/empty-state";
import { FocusTitle } from "../ui/focus-title";
import { INVESTMENT_LABELS, type InvestmentField, type InvestmentFigures } from "../ui/investment-card";
import { DETAIL_BAR, useScrolledPast } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { ListSkeleton, Skeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { TopBand, usePageAtEnd } from "../ui/top-band";
import { useHoldWrites } from "../use-is-viewer";
import { assertNoError, useWrite, type WriteFailure } from "../use-write";
import { projectStateLine } from "./project-detail-screen";
import { FiguresGroup, LoansGroup, type InvestmentRowRefs, type PropertyExtras } from "./project-investment-cards";
import { toProjectInvestment, type ProjectInvestment } from "./project-investment-data";
import { InvestmentEditSheet, type InvestmentPatch } from "./project-investment-sheets";
import {
  BandRowLink,
  MetricsGroup,
  PartsSection,
  ReturnsCardsFailed,
  ReturnsCardsSkeleton,
  bandRows,
  flipBandFigure,
  investmentAttentionRows,
  investmentKind,
  rentBandFigure,
  type InvestmentKind,
} from "./project-returns-cards";
import { SELLING_COST_DEFAULT_BP, usePropertyReturnsQuery, type PropertyReturns } from "./project-returns-data";
import type { EditField, InfoKey } from "./project-returns-info";
import { editFieldOf, investmentBase, pageResolver, type Resolve } from "./project-returns-parts";
import { HowSheet, PERCENT_KINDS, PercentSheet, ReturnInfoSheet } from "./project-returns-sheets";

/** The segment under the parts: the property's figures, the metrics, the loans. */
export type InvestmentTab = "property" | "metrics" | "loans";

const TABS: { value: InvestmentTab; label: string }[] = [
  { value: "property", label: "נכס" },
  { value: "metrics", label: "מדדים" },
  { value: "loans", label: "הלוואות" },
];

/** The line under the band's title, when the project has no state of its own to say. */
const KIND_LINES: Record<InvestmentKind, string> = { rent: "השכרה · 12 חודשים אחרונים", flip: "שיפוץ ומכירה" };

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

/** `tax` and `selling` are the two percent sheets (FLOW-1068). */
type OpenSheet = InvestmentField | "tax" | "selling" | null;

/** The sheet an input opens: a figure's own, or one of the percent sheets. */
function sheetOf(field: EditField): Exclude<OpenSheet, null> {
  return field === "tax_bracket" ? "tax" : field === "selling_cost" ? "selling" : field;
}

const INFO_LAYER = "investment-info-";
const INVESTMENT_FIELDS: readonly string[] = ["purchase", "arv", "value", "land", "units"];

function isInvestmentField(value: unknown): value is InvestmentField {
  return typeof value === "string" && INVESTMENT_FIELDS.includes(value);
}

/** FLOW-1071: the tab the URL names (`?tab=metrics`), or null. */
export function tabFromSearch(search: string): InvestmentTab | null {
  const value = new URLSearchParams(search).get("tab");
  return value === "property" || value === "metrics" || value === "loans" ? value : null;
}

/** The ⓘ sheet that was open under a page it opened, from the history entry Back lands on. */
function infoFromHistory(state: unknown): InfoKey | null {
  const layer = sheetStack(state).find((name) => name.startsWith(INFO_LAYER));
  return layer == null ? null : (layer.slice(INFO_LAYER.length) as InfoKey);
}

export const TAX_REFUSED = "רק בעל העסק יכול לשנות את מדרגת המס.";
export const LAND_ACCOUNT_REFUSED = "רק בעל העסק יכול לבחור את חשבון הקרקע.";

/** Sample mode names the suggested land account the way the server reads it (0248). */
function landFromSuggestion(r: PropertyReturns): PropertyReturns {
  const s = r.inputs.landSuggestion;
  if (s == null) return r;
  return {
    ...r,
    inputs: { ...r.inputs, landMinor: s.minor, landSource: "books", landAccount: { id: s.accountId, name: s.name }, landSuggestion: null },
    missing: r.missing.filter((input) => input !== "land"),
  };
}

/**
 * Sample mode sets the costs of selling the way the server reads them (decision 0261): a percent of
 * the ARV, half to even, out of the net profit, and the renovation's figures that rest on it; null is
 * the default 8%.
 */
export function sellingSample(r: PropertyReturns, bp: number | null): PropertyReturns {
  const sellingBp = bp ?? SELLING_COST_DEFAULT_BP;
  const arv = r.inputs.arvMinor;
  const selling = arv == null ? null : divHalfEven(arv * BigInt(sellingBp), 10_000n);
  const before = r.deal.sellingCostMinor;
  const net = r.deal.netProfitMinor == null || selling == null || before == null ? r.deal.netProfitMinor : r.deal.netProfitMinor + before - selling;
  const moneyIn = r.equity.moneyInMinor;
  const costs = r.inputs.purchaseMinor == null || r.inputs.rehabMinor == null ? null : r.inputs.purchaseMinor + r.inputs.rehabMinor - r.deal.holdingMinor;
  const roi = net == null || moneyIn == null || moneyIn <= 0n ? null : Number(net * 10_000n / moneyIn);
  const days = r.deal.heldDays;
  return {
    ...r,
    deal: { ...r.deal, sellingCostBp: sellingBp, sellingCostDefault: bp == null, sellingCostMinor: selling, netProfitMinor: net },
    metrics: {
      ...r.metrics,
      flipRoiBp: roi,
      flipRoiYearBp: roi == null || days == null || days <= 0 ? null : Math.round((roi * 365) / days),
      arvMarginBp: net == null || arv == null || arv <= 0n ? null : Number(net * 10_000n / arv),
      breakEvenSaleMinor: costs == null ? null : divHalfEven(costs * 10_000n, BigInt(10_000 - sellingBp)),
    },
  };
}

/** a ÷ b rounded half to even, for amounts at or above zero. */
function divHalfEven(a: bigint, b: bigint): bigint {
  const q = a / b;
  const twice = (a % b) * 2n;
  return twice > b || (twice === b && q % 2n === 1n) ? q + 1n : q;
}

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
 * FLOW-446, FLOW-451; FLOW-1047 (boards V3-Investment, V3-Investment-Rent): a project's investment and
 * loans, an Overview. The band by kind (a rental's total return with the money in the deal and today's
 * equity, a renovation's expected profit with the ARV and the total cost) and its "איך מחושב" sheet; then
 * "חסר לחישוב" cards opening the input sheets; the parts of the figure, each opening its calculation; and
 * a segment that docks into the bar: the property's figures (each opening its edit sheet), the metrics
 * (each opening its page) and the loans. A viewer reads it; nothing opens for a write. `sample` draws it
 * with no network (stories, dev route).
 */
export function ProjectInvestmentScreen({
  sample,
  sampleInvestment,
  sampleReturns,
  initialSheet = null,
  initialInfo = null,
  initialHow = false,
  initialTab = "property",
  backTo,
  base: baseProp,
  today = israelToday(),
}: {
  sample?: NonNullable<ProjectDetail>;
  sampleInvestment?: ProjectInvestment;
  sampleReturns?: PropertyReturns;
  /** Stories open a sheet on first draw. */
  initialSheet?: OpenSheet;
  initialInfo?: InfoKey | null;
  /** Stories open "איך מחושב", or a tab, on first draw. */
  initialHow?: boolean;
  initialTab?: InvestmentTab;
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
  const [sheet, setSheet] = useState<OpenSheet>(() => {
    if (readOnly) return null;
    if (initialSheet != null) return initialSheet;
    if (linked != null) return sheetOf(linked);
    return null;
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
  };
  const setInfoSheet = useSheetHistory(`${INFO_LAYER}${infoKey}`, info != null, (next) => { setInfo(next ? infoKey : null); });
  // FLOW-1047: "איך מחושב" in the band, the tab under the parts, and the bar that docks the tab.
  const [how, setHow] = useState(initialHow);
  const howOpener = useRef<HTMLElement | null>(null);
  const setHowSheet = useSheetHistory("investment-how", how, setHow);
  // FLOW-1071: the tab is kept in the page's URL (`?tab=`, a replace), so Back from a metric or a loan lands on it.
  const [tab, setTab] = useState<InvestmentTab>(() => tabFromSearch(location.search) ?? initialTab);
  const [titleEnd, setTitleEnd] = useState<HTMLSpanElement | null>(null);
  const markPast = useScrolledPast(titleEnd, true, DETAIL_BAR);
  const atEnd = usePageAtEnd();
  const past = markPast || atEnd;
  const { markRef, docked, scrollUnderBar } = useDockedFilter({ barShown: past, bar: DETAIL_BAR });
  const online = useOnline();
  // An attention card links here with `?edit=`: a link that lands while the page is open opens that sheet too.
  const arrived = useRef(location.key);
  useEffect(() => {
    if (arrived.current === location.key) return;
    arrived.current = location.key;
    const field = editFieldOf(new URLSearchParams(location.search).get("edit"));
    if (field == null || readOnly) return;
    const next = sheetOf(field);
    if (isInvestmentField(next)) setEditField(next);
    setSheet(next);
  }, [location.key, location.search, readOnly]);
  // The key is consumed on arrival and leaves the URL (a replace), so Back to this page's entry URL, the way the
  // sheet came back, does not open it again (the owner, 2026-11-05: "every time I return to this page the drawer
  // is opened"). The page's own links never carried it: their `search` is `usePreviewSearch()`, only `preview`.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has("edit")) return;
    params.delete("edit");
    const rest = params.toString();
    void navigate({ pathname: location.pathname, search: rest === "" ? "" : `?${rest}`, hash: location.hash }, { replace: true, state: location.state as unknown });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

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
  // The land account named before a save: set_land_account returns it as `prior`, and ביטול names it again.
  const landPrior = useRef<string | null>(null);
  const saveLand = useWrite<{ accountId: string | null; undo: boolean }>({
    failure: (error) => {
      if ((error as { code?: string }).code === "42501") return { message: LAND_ACCOUNT_REFUSED, retry: false };
      return (error as { undo?: boolean }).undo === true ? "לא הצלחנו לבטל את שווי הקרקע מהספרים." : "לא הצלחנו לקחת את שווי הקרקע מהספרים.";
    },
    keys: ["project"],
    run: async ({ accountId, undo }) => {
      try {
        const supabase = getSupabase();
        if (!supabase) throw new Error("supabase");
        const result = await supabase.rpc("set_land_account", { p_account_id: accountId as string });
        assertNoError(result);
        landPrior.current = (result.data as { prior?: string | null } | null)?.prior ?? null;
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error("failed"), { undo });
      }
    },
  });
  // FLOW-470: the land drives the tax savings, so taking it from the books can be undone, as every figure's save.
  const onUseLand = (accountId: string) => {
    void (async () => {
      let undo: () => void;
      if (sampled) {
        const before = sampleRet;
        setSampleRet((current) => (current == null ? current : landFromSuggestion(current)));
        undo = () => { setSampleRet(before); };
      } else {
        try {
          await saveLand.mutateAsync({ accountId, undo: false });
        } catch {
          return;
        }
        const prior = landPrior.current;
        undo = () => { saveLand.mutate({ accountId: prior, undo: true }); };
      }
      toast.show({ message: "שווי הקרקע נלקח מהספרים", action: "ביטול", onAction: undo });
    })();
  };
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

  // FLOW-1068: the costs of selling, a percent of the ARV; null goes back to the default 8%.
  const sellingRef = useRef<number | null>(null);
  const saveSelling = useWrite<number | null>({
    failure: (error) => ((error as { code?: string }).code === "42501" ? { message: INVESTMENT_REFUSED, retry: false } : "לא הצלחנו לשמור את עלויות המכירה."),
    keys: ["project"],
    run: async (bp) => {
      const supabase = getSupabase();
      if (!supabase || projectId === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("set_project_investment", { p_project_id: projectId, p_patch: { selling_cost_bp: bp } }));
    },
  });
  const commitSelling = useCallback(async (bp: number | null): Promise<boolean> => {
    if (sampled) {
      setSampleRet((current) => (current == null ? current : sellingSample(current, bp)));
      return true;
    }
    try {
      await saveSelling.mutateAsync(bp);
      return true;
    } catch {
      return false;
    }
  }, [sampled, saveSelling]);
  const onSaveSelling = useCallback(async (bp: number | null): Promise<boolean> => {
    const before = sellingRef.current;
    if (!(await commitSelling(bp))) return false;
    toast.show({ message: "עלויות המכירה עודכנו", action: "ביטול", onAction: () => { void commitSelling(before); } });
    return true;
  }, [commitSelling, toast]);
  sellingRef.current = returns == null || returns.deal.sellingCostDefault ? null : returns.deal.sellingCostBp;

  const currency = data?.figures?.currency ?? data?.loans[0]?.currency ?? companyCurrency;
  const figures = data == null ? null : (hasFigures ? data.figures : loansOnly(currency, data));
  const extras: PropertyExtras | null = returns == null ? null : {
    landMinor: returns.inputs.landMinor,
    units: returns.inputs.units,
    unitsDefault: returns.inputs.unitsDefault,
    purchaseMinor: returns.inputs.purchaseMinor,
    purchaseSource: returns.inputs.purchaseSource,
    takenOverMinor: returns.inputs.takenOverMinor,
    landSource: returns.inputs.landSource,
    landAccount: returns.inputs.landAccount,
    landSuggestion: returns.inputs.landSuggestion,
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
  const openEdit = (field: EditField) => {
    const next = sheetOf(field);
    if (isInvestmentField(next)) setEditField(next);
    setSheet(next);
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
  const back = backTo ?? `/projects/${projectId}${search}`;
  const kind = investmentKind({
    overhead: data?.isOverhead === true,
    budget: project?.budget_agorot != null,
    arv: (returns == null ? figures?.arvMinor : returns.inputs.arvMinor) != null,
    value: (returns == null ? figures?.valueMinor : returns.inputs.valueMinor) != null,
    rent: returns?.firstRent != null,
  });
  const band = returns == null || !hasFigures ? null : kind === "rent" ? rentBandFigure(returns) : flipBandFigure(returns);
  const tabs = hasFigures ? TABS : TABS.filter((option) => option.value === "loans");
  const shownTab = hasFigures ? tab : "loans";
  const control = (
    <SegmentedControl
      label="תצוגה"
      showLabel={false}
      value={shownTab}
      options={tabs}
      onChange={(next) => {
        setTab(next);
        const params = new URLSearchParams(location.search);
        if (next === "property") params.delete("tab");
        else params.set("tab", next);
        const rest = params.toString();
        void navigate({ pathname: location.pathname, search: rest === "" ? "" : `?${rest}`, hash: location.hash }, { replace: true, state: location.state as unknown });
        scrollUnderBar();
      }}
    />
  );

  if (phase.kind === "loading") return <InvestmentLoading back={back} name={name} />;
  if (phase.kind === "empty") return <InvestmentEmpty back={back} name={name} />;
  if (phase.kind === "error") {
    return (
      <BandLoadFailed
        title={name == null ? "ההשקעה לא נטענה" : `ההשקעה ב${name} לא נטענה`}
        offline={phase.offline || !online}
        leading={<BackButton fallback={back} text={name ?? "פרויקט"} onBand />}
        onRetry={() => { void detail.refetch(); }}
      />
    );
  }
  if (figures == null || data == null) return <InvestmentLoading back={back} name={name} />;
  const offlineSince = sampled || online || preview !== "off" ? null : (detail.dataUpdatedAt || null);
  const loansGroup = (
    <LoansGroup
      figures={figures}
      loans={data.loans}
      today={today}
      search={search}
      onAdd={readOnly ? undefined : () => {
        // The loans tab's new-loan sheet, with this project set (FLOW-139d).
        void navigate(quickNewPath("/loans", search, "loan"), { state: { newLoanProject: projectId } });
      }}
    />
  );

  return (
    <div className="ui-pinv flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        leading={<BackButton fallback={back} text={name ?? "פרויקט"} onBand />}
        trailing={returns == null || !hasFigures ? undefined : (
          <button type="button" className="ui-pinv-how m-press" onClick={(event) => { howOpener.current = event.currentTarget; setHow(true); }}>
            איך מחושב
          </button>
        )}
        heroClassName="ui-pinv-hero"
        hero={(
          <>
            <FocusTitle className="t-name">השקעה והלוואות</FocusTitle>
            <p className="t-line2 ui-pinv-band-kind">{stateLine ?? (hasFigures ? KIND_LINES[kind] : "הלוואות")}</p>
            {offlineSince == null ? null : <BandOfflineLine since={offlineSince} />}
            {!hasFigures ? null : band == null ? (
              returnsRead.isError && !sampled ? null : <Skeleton tone="band" className="ui-skel-project-num" />
            ) : (
              <>
                <p className="ui-band-label">{band.label}</p>
                <p className="ui-pinv-band-figure">{band.figure}</p>
                {band.sub == null ? null : <p className="ui-pinv-band-sub t-meta">{band.sub}</p>}
                {band.partial == null ? null : <p className="ui-pinv-band-sub t-meta">{band.partial}</p>}
                {returns == null ? null : (
                  <div className="ui-pinv-band-rows">
                    {bandRows(kind, returns).map((row) => (
                      <BandRowLink key={row.key} row={row} currency={returns.currency} resolve={resolve} onInfo={onInfo} readOnly={readOnly} />
                    ))}
                  </div>
                )}
              </>
            )}
            <span ref={setTitleEnd} className="ui-compact-mark" aria-hidden="true" />
          </>
        )}
      />
      <CompactBar
        title={name == null ? "השקעה והלוואות" : `${name} · ${band?.short ?? "השקעה והלוואות"}`}
        figure={band?.bar ?? undefined}
        backTo={back}
        size="detail"
        shown={past}
        dock={control}
        docked={docked}
      />
      <div className="ui-pinv-stack ui-page-pad">
        {returns == null || !hasFigures ? null : (
          <AttentionCards rows={investmentAttentionRows(kind, returns, base, search, readOnly)} storageKey={`investment:${projectId}`} title="חסר לחישוב" />
        )}
        {!hasFigures ? null : returns != null ? (
          <PartsSection kind={kind} returns={returns} resolve={resolve} onInfo={onInfo} onAdd={onAdd} />
        ) : returnsRead.isError ? (
          <ReturnsCardsFailed offline={returnsRead.isPaused} onRetry={() => { void returnsRead.refetch(); }} />
        ) : <ReturnsCardsSkeleton />}
        <span ref={markRef} className="ui-compact-mark" aria-hidden="true" />
        {hasFigures ? <DockSlot docked={docked}>{control}</DockSlot> : null}
        <div className="ui-pinv-groups">
          {shownTab === "property" ? (
            <FiguresGroup
              figures={figures}
              extras={extras}
              readOnly={readOnly}
              rows={rows}
              linesHref={`${base}/returns/acquisition${search}`}
              rehabHref={`${base}/part/rehab${search}`}
              onEdit={openEdit}
              onUseLand={readOnly ? undefined : onUseLand}
              landBusy={saveLand.isPending}
            />
          ) : shownTab === "metrics" ? (
            returns == null ? <ListSkeleton /> : <MetricsGroup kind={kind} returns={returns} base={base} search={search} onAdd={onAdd} />
          ) : loansGroup}
        </div>
      </div>
      {returns == null || !hasFigures ? null : (
        <>
          <ReturnInfoSheet
            infoKey={infoKey}
            open={info != null}
            onOpenChange={setInfoSheet}
            returns={returns}
            resolve={resolve}
            readOnly={readOnly}
            returnFocusRef={infoOpener}
          />
          <HowSheet kind={kind} open={how} onOpenChange={setHowSheet} returns={returns} resolve={resolve} readOnly={readOnly} returnFocusRef={howOpener} />
        </>
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
          <PercentSheet
            kind={PERCENT_KINDS.tax}
            open={sheet === "tax"}
            onOpenChange={(next) => { setSheet(next ? "tax" : null); }}
            bp={returns?.inputs.taxBracketBp ?? null}
            onSave={onSaveBracket}
          />
          <PercentSheet
            kind={PERCENT_KINDS.selling}
            open={sheet === "selling"}
            onOpenChange={(next) => { setSheet(next ? "selling" : null); }}
            bp={returns == null || returns.deal.sellingCostDefault ? null : returns.deal.sellingCostBp}
            onSave={onSaveSelling}
          />
        </>
      )}
    </div>
  );
}

/** Nothing to show yet (a preview with no data): the band's title, and what will come. */
function InvestmentEmpty({ back, name }: { back: string; name: string | undefined }) {
  return (
    <div className="ui-pinv flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        leading={<BackButton fallback={back} text={name ?? "פרויקט"} onBand />}
        heroClassName="ui-pinv-hero"
        hero={<FocusTitle className="t-name">השקעה והלוואות</FocusTitle>}
      />
      <EmptyState title="אין עדיין נתונים" body="מחיר הקנייה, השווי וההלוואות של הנכס יופיעו כאן." />
    </div>
  );
}

/** The band and the rows while the project is read: the title stays real, the figure and the rows pulse. */
function InvestmentLoading({ back, name }: { back: string; name: string | undefined }) {
  return (
    <div className="ui-pinv flex min-h-full flex-1 flex-col" aria-busy="true">
      <TopBand
        wordmark={false}
        leading={<BackButton fallback={back} text={name ?? "פרויקט"} onBand />}
        heroClassName="ui-pinv-hero"
        hero={(
          <>
            <FocusTitle className="t-name">השקעה והלוואות</FocusTitle>
            <Skeleton tone="band" className="ui-skel-project-label" />
            <Skeleton tone="band" className="ui-skel-project-num" />
          </>
        )}
      />
      <ListSkeleton />
    </div>
  );
}
