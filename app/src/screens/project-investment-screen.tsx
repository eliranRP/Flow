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
import { EquityCard, FiguresCard, LoansCard, type InvestmentRowRefs } from "./project-investment-cards";
import {
  toProjectInvestment,
  useRehabCategoriesQuery,
  useRehabCostsQuery,
  type ProjectInvestment,
  type RehabCategory,
} from "./project-investment-data";
import { InvestmentEditSheet, RehabSheet, type InvestmentPatch } from "./project-investment-sheets";

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

/** The patch that puts a figure back as it was (a missing figure goes back to null). */
function restorePatch(field: InvestmentField, before: InvestmentFigures): InvestmentPatch {
  const toNumber = (value: bigint | null) => (value == null ? null : Number(value));
  if (field === "purchase") return { purchase_minor: toNumber(before.purchaseMinor) };
  if (field === "arv") return { arv_minor: toNumber(before.arvMinor) };
  return { value_minor: toNumber(before.valueMinor), value_date: before.valueMinor == null ? null : before.valueDate };
}

type OpenSheet = InvestmentField | "rehab" | null;

const REHAB_LAYER = "investment-rehab";

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
 * FLOW-446 (board Invest): a project's investment and loans, its own page under the project. The
 * equity card, the property's figures (each opens its edit sheet, rehab opens its breakdown) and the
 * loans. A viewer reads it; nothing opens. `sample` draws it with no network (stories, dev route).
 */
export function ProjectInvestmentScreen({
  sample,
  sampleInvestment,
  sampleCategories,
  initialSheet = null,
  backTo,
  today = israelToday(),
}: {
  sample?: NonNullable<ProjectDetail>;
  sampleInvestment?: ProjectInvestment;
  sampleCategories?: RehabCategory[];
  /** Stories open a sheet on first draw. */
  initialSheet?: OpenSheet;
  /** Dev fixtures send Back here. Production goes to the project page. */
  backTo?: string;
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
  const sampled = sampleInvestment != null;
  const [sampleData, setSampleData] = useState(sampleInvestment);
  const data = sampleData ?? (project == null ? null : toProjectInvestment(project));
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);

  // Back from a category's lines lands on the rehab sheet's own history entry: open it again there.
  const [sheet, setSheet] = useState<OpenSheet>(() => {
    if (readOnly) return null;
    return initialSheet ?? (sheetStack(location.state).includes(REHAB_LAYER) ? "rehab" : null);
  });
  const [editField, setEditField] = useState<InvestmentField>(
    initialSheet === "purchase" || initialSheet === "arv" || initialSheet === "value" ? initialSheet : "purchase",
  );
  const rows: InvestmentRowRefs = {
    purchase: useRef<HTMLButtonElement>(null),
    arv: useRef<HTMLButtonElement>(null),
    value: useRef<HTMLButtonElement>(null),
    rehab: useRef<HTMLButtonElement>(null),
  };
  const rehabOpen = sheet === "rehab";
  const costs = useRehabCostsQuery(projectId, rehabOpen && !sampled);
  const categories = useRehabCategoriesQuery(rehabOpen && !sampled);
  const setRehabSheet = useSheetHistory(REHAB_LAYER, rehabOpen, (next) => { setSheet(next ? "rehab" : null); });

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
  const figuresRef = useRef<InvestmentFigures | null>(null);
  const commit = useCallback(async (patch: InvestmentPatch, field: InvestmentField): Promise<boolean> => {
    if (sampled) {
      setSampleData((current) => current == null || current.figures == null ? current : { ...current, figures: applySample(current.figures, patch) });
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
    if (!(await commit(patch, field))) return false;
    // The undo puts the figure back as it was; it is a second save, so nothing in the database changes shape.
    if (before != null) {
      toast.show({
        message: `${INVESTMENT_LABELS[field]} ${kind === "clear" ? "נמחק" : "עודכן"}`,
        action: "ביטול",
        onAction: () => { void commit(restorePatch(field, before), field); },
      });
    }
    return true;
  }, [commit, toast]);

  const currency = data?.figures?.currency ?? data?.loans[0]?.currency ?? companyCurrency;
  const hasFigures = data != null && !data.isOverhead && data.figures != null;
  const figures = data == null ? null : (hasFigures ? data.figures : loansOnly(currency, data));
  figuresRef.current = hasFigures ? figures : null;
  const editMinor = figures == null ? null : editField === "purchase" ? figures.purchaseMinor : editField === "arv" ? figures.arvMinor : figures.valueMinor;
  const rehabCosts = sampled ? (sampleData?.categories ?? []) : (costs.data ?? []);
  const rehabCategories = sampled ? (sampleCategories ?? []) : (categories.data ?? null);
  const openEdit = (field: InvestmentField) => {
    setEditField(field);
    setSheet(field);
  };
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
              <EquityCard figures={figures} rows={rows} onAdd={readOnly ? undefined : openEdit} />
              <FiguresCard
                figures={figures}
                readOnly={readOnly}
                rows={rows}
                onEdit={openEdit}
                onRehab={() => { setRehabSheet(true); }}
              />
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
