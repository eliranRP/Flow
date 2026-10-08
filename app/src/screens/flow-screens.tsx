import { flushSync } from "react-dom";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { formatAmountText, formatIls, formatMoney, shekelsToAgorot, type CategoryRow, type Dashboard, type FiledTodayRow, type ProjectDetail, type ProjectRow, type ProjectWaitingRow, type ReviewRow, type TransactionDetail, type UnpaidRow } from "@flow/shared";
import { projectAmountFigures, projectExpenseMinor, projectMarginHint, projectRows, type ProjectCurrencyRow } from "../by-currency";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { Navigate, NavigationType, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router-dom";
import { LoanReadError, LoanTransactionSplit, ProjectLoanList, useLoanBalances, type LoanBalanceRow } from "./loan-match";
import { loanRowProps, useLoanMarks, type LoanMark } from "./loan-marks";
import { absAgorot } from "../agorot";
import * as reviewE2eFixture from "../dev/review-e2e-fixture";
import { overheadHint, shownProfit } from "../overhead";
import { useAuth } from "../auth";
import { useHoldWrites, useIsViewer, useWriteGate, ViewerNote, ViewerScope } from "../use-is-viewer";
import { addTriggerRef } from "../add-trigger";
import { getSupabase } from "../lib/supabase";
import { periodLabel } from "../period";
import { keepPreview, useFlowSearch, useHomePreview, usePreviewSearch, type HomePreview } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import {
  activeProjects,
  allocate,
  basisToPercents,
  evenBasis,
  formatShare,
  incomeBasis,
  percentToBp,
  sharesForSave,
  splitIsValid,
  type AllocatedPart,
  type SplitMethod,
  type SplitProject,
} from "../split-math";
import { withSheetBackground } from "../sheet-background";
import { safeAppPath } from "../safe-return";
import { useRefreshingNow } from "../israel-clock";
import { hebrewMercuryError } from "../mercury-copy";
import { hebrewSumitError, israelSyncPhrase, retryClockParts } from "../sumit-copy";
import { isStandalone } from "../ui/install-prompt";
import {
  useBooks,
  useCategoriesQuery,
  useDashboardQuery,
  useFiledTodayQuery,
  useInvalidateBooks,
  useProjectCategoryQuery,
  useProjectQuery,
  useProjectWaitingQuery,
  useReviewQuery,
  useMercuryStatusQuery,
  useSumitStatusQuery,
  useLineMetaPageQuery,
  useLineMetaQuery,
  useTransactionQuery,
  useUnpaidQuery,
} from "../use-books";
import { ApproveNotice, isApproveRetry, readApproveOutcome } from "../approve-review";
import { LEDGER_FOCUS_KEYS } from "../books-focus";
import { FILED_TODAY_EMPTY_BODY, FILED_TODAY_EMPTY_TITLE, filedTodayBannerTitle } from "../filed-today-copy";
import { useHeldOrder } from "../list-hold";
import { pinReviewHead, pinReviewLine, releaseReviewHold, reviewHold, reviewPin } from "../review-pin";
import { TxnNavButtons, txnListState, usePrefetchNeighbours, useAnnounceTxn, useTxnNav, useTxnNavKeys } from "../txn-nav";
import { emptyVisit, noteHandled, notePresence, visitPlace } from "../visit-meter";
import { assertNoError, isTransientWriteError, useWrite } from "../use-write";
import { useSyncSettled } from "../use-sync-settled";
import { invokeEdge } from "../edge";
import { useMercuryConnect } from "../use-mercury-connect";
import { useSumitConnect } from "../use-sumit-connect";
import { MercuryConnectSheet } from "../ui/mercury-connect-sheet";
import { SumitConnectSheet } from "../ui/sumit-connect-sheet";
import { SAMPLE_TOAST } from "../setup/copy";
import { AssistantSettings, useAssistantStatusQuery, type AssistantSample } from "./assistant-settings";
import { COMPANY_NAME_MAX, RenameCompanySheet, companyNameError } from "./rename-company";
import { useJevQueue, useJevReview, useReviewFlags } from "./jev-review-card";
import { bindJevConnectorScope, clearJevConnectorFlag, jevShown, withJev, type JevShown } from "./jev-review";
import { JEV_DEFAULT, JevSettings, jevSwitchOn, useJevIntegrationQuery, type JevCardState } from "./jev-settings";
import { LoanSettingsSection, type LoanCurrency, type LoanProjectChoice, type LoanRowsSample } from "./loan-setup";
import { SetupSampleReview } from "../setup/sample-review";
import { useSetupSettingsEntry } from "../setup/settings-row";
import { Banner } from "../ui/banner";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { CheckRow } from "../ui/check-row";
import { StatusPill } from "../ui/chip";
import { formatDayMonth, formatDisplay, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { HoldLine } from "../ui/hold-line";
import { BackButton, historyIndex, popSheetLayers, sheetStack, transactionParent, useGoBack, useSheetHistory } from "../ui/back";
import { useFocusRowAfterRetry } from "../ui/focus-retry";
import { IconButton } from "../ui/icon-button";
import { AlertIcon, BankIcon, BellIcon, BuildingIcon, CameraIcon, CheckIcon, ChevronDownIcon, CloseIcon, DocumentIcon, DownloadIcon, GoogleIcon, KeptOutIcon, LoanIcon, LockIcon, LogoutIcon, MoreIcon, PencilIcon, PlugIcon, PlusIcon, ProjectsIcon, RefreshIcon, ReviewIcon, SearchIcon, SplitIcon, TagIcon, TrashIcon } from "../ui/icons";
import { BandFigures, BandHero, SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { MonthList } from "../ui/month-list";
import { statementMethodOf } from "../ui/statement";
import { CHANGE_SAVE_FAILURE, ChangeAssignment, changeSaveFailure, COLLAPSE_PICK_HOLD, COLLAPSE_SPLIT_NOTE, ONE_PROJECT_DETAIL, ONE_PROJECT_OPTION, type ChangeChoice } from "../ui/change-sheet";
import { FocusTitle } from "../ui/focus-title";
import { MoneyField, PercentField } from "../ui/money-field";
import { ConnectorRow } from "../ui/connector-row";
import { BudgetBar, ProgressBar } from "../ui/progress-bar";
import { RadioRow } from "../ui/radio-row";
import { REVIEW_MISMATCH_ID, REVIEW_MISSING_ID, ReviewCard, SPLIT_MISMATCH_ACTION, SPLIT_MISMATCH_KEEP } from "../ui/review-card";
import { ActionBar, ActionBarRow } from "../ui/action-bar";
import { jevReasonText, reviewFlagView } from "../review-copy";
import { ReviewSkippedSection, skippedListPath, useSkippedReviewQuery } from "./review-skipped";
import { ReviewSkippedLink } from "../ui/review-skipped-list";
import { BankDetails } from "../ui/bank-details";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SearchField } from "../ui/search-field";
import { SegmentedControl } from "../ui/segmented-control";
import { Sheet } from "../ui/sheet";
import { RouteSheet } from "../ui/route-sheet";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { TopBand } from "../ui/top-band";
import { ListSkeleton, Skeleton } from "../ui/skeleton";
import { isReversal, reversalChoices } from "../reversal";
import { ReversalTag } from "../ui/suggest-tag";
import { splitDraftKey } from "../split-drafts";
import type { LineSplitRead } from "../line-split";
import { LineSplitSection, lineSplitRowHint, useLineSplitQuery, useLoanSplitFlag } from "./line-split";
import { hasCategorySplit, LINE_HAS_CATEGORY_SPLIT, projectSplitFailure } from "../line-split-copy";

function blockedPreview(preview: HomePreview, tell: (message: string) => void): boolean {
  if (preview === "off") return false;
  tell("במצב תצוגה זה לא נשמר.");
  return true;
}

function useBlockedPreview(): (mode?: HomePreview) => boolean {
  const preview = useHomePreview();
  const toast = useToast();
  return (mode?: HomePreview) => blockedPreview(mode ?? preview, (message) => {
    toast.show({ tone: "info", message });
  });
}

async function collapseSplit(transactionId: string, projectId: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase || transactionId === "" || projectId === "") throw new Error("supabase");
  const saved = await supabase.rpc("collapse_split", { p_id: transactionId, p_project_id: projectId });
  assertNoError(saved);
  return typeof saved.data === "string" ? saved.data : null;
}

async function saveNewProject(
  name: string,
  blocked: () => boolean,
  toast: { show: (toast: { tone?: "bad" | "info"; message: string }) => void },
  remember: (project: ChangeChoice) => void,
  invalidate: (keys: readonly string[]) => Promise<void>,
): Promise<ChangeChoice> {
  if (blocked()) throw new Error("preview");
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  try {
    const saved = await supabase.rpc("upsert_project", { p_name: name, p_status: "active" });
    assertNoError(saved);
    if (typeof saved.data !== "string") throw new Error("supabase");
    const created = { id: saved.data, name, status: "active" as const };
    remember(created);
    await invalidate(["dashboard"]);
    toast.show({ message: "הפרויקט נשמר" });
    return created;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "preview") {
      toast.show({ tone: "bad", message: "לא הצלחנו לשמור את הפרויקט." });
    }
    throw error;
  }
}

/** `initialName` lets a story open on a typed name, checked as if the field had been left. */
export function OnboardingScreen({ initialName }: { initialName?: string } = {}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [params] = useSearchParams();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const [name, setName] = useState(initialName ?? "");
  const [nameError, setNameError] = useState(() => (initialName == null ? undefined : companyNameError(initialName)));
  const nameRef = useRef<HTMLInputElement>(null);
  const [vat, setVat] = useState<"registered" | "exempt">("registered");
  const previewSearch = usePreviewSearch();
  const returnPath = safeAppPath(params.get("return")) ?? "/";
  const returnTo = keepPreview(returnPath, previewSearch);
  const writeGate = useWriteGate(returnPath);
  const save = useWrite({
    failure: "לא הצלחנו לשמור.",
    keys: ["home", "dashboard", "sumit"],
    onSuccess: () => {
      void navigate(returnTo, { replace: true });
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("create_company", { p_name: name.trim(), p_vat_registered: vat === "registered" }));
      await client.refetchQueries({ queryKey: ["dashboard"], type: "all" });
    },
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (holdWrites || save.isPending) return;
    // The create_company rule (FLOW-606), on the field instead of a save toast.
    const problem = companyNameError(name);
    // Commit the message before focus, so the field is announced with it.
    flushSync(() => { setNameError(problem); });
    if (problem) {
      nameRef.current?.focus();
      return;
    }
    if (blocked()) return;
    save.mutate();
  }

  const step = 1;
  const steps = 1;
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  return (
    <main className="ui-onboard">
      <div className="ui-progress-row">
        <ProgressBar
          variant="slim"
          value={step}
          max={steps}
          label={`שלב ${String(step)} מתוך ${String(steps)}`}
          caption={
            <span className="t-hint">
              שלב <bdi className="ui-num" dir="ltr">{String(step)}</bdi> מתוך <bdi className="ui-num" dir="ltr">{String(steps)}</bdi>
            </span>
          }
        />
      </div>
      <ScreenHeader title="פרטי העסק" subtitle="השם שיופיע בבית." backTo={returnTo} />
      <form className="ui-page-pad" onSubmit={submit}>
        <TextField
          ref={nameRef}
          label="שם העסק"
          value={name}
          maxLength={COMPANY_NAME_MAX * 2 + 20}
          aria-required="true"
          reserveMessage
          error={nameError}
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(undefined);
          }}
          onBlur={() => {
            setNameError(companyNameError(name));
          }}
        />
        <SegmentedControl
          label="סוג העסק"
          value={vat}
          onChange={setVat}
          options={[
            { value: "registered", label: "עוסק מורשה" },
            { value: "exempt", label: "עוסק פטור" },
          ]}
        />
        <p className="t-hint">עוסק מורשה: מע״מ 18%.</p>
        <Button type="submit" busy={save.isPending} disabled={holdWrites}>המשך</Button>
      </form>
    </main>
  );
}

/** `initialQuery` lets a story open on a search without moving focus off the title. */
export function ProjectsScreen({ sample, initialQuery = "" }: { sample?: Dashboard; initialQuery?: string } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const dashboard = useDashboardQuery(sample == null);
  const books = useBooks();
  const holdWrites = useHoldWrites();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [expanded, setExpanded] = useState(false);
  const phase: ScreenPhase = sample ? { kind: "ready" } : screenPhase(preview, dashboard);
  const data = sample ?? dashboard.data;
  const sheet = (
    <Sheet open={open} onOpenChange={setOpen} title="פרויקט">
      <ProjectForm onClose={() => { setOpen(false); }} />
    </Sheet>
  );
  const empty = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="פרויקטים" />
      <EmptyState
        icon={<ProjectsIcon />}
        title="עוד אין פרויקטים"
        body={holdWrites ? "פרויקטים מגיעים מ־SUMIT." : "פרויקטים מגיעים מ־SUMIT, ואפשר גם לפתוח אחד כאן."}
        action={holdWrites ? undefined : <Button variant="pill" icon={<PlusIcon size={16} />} onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
      />
      {sheet}
    </div>
  );
  if (phase.kind === "empty" || (phase.kind === "ready" && (data?.projects.length ?? 0) === 0)) return empty;
  return (
    <>
      <ScreenState
        title="פרויקטים"
        subtitle={data ? `${String(data.projects.filter((project) => project.status === "active").length)} פעילים · רווח ${periodLabel(books.period)}` : undefined}
        action={holdWrites ? undefined : <Button variant="pill" icon={<PlusIcon size={16} />} onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
        loading={
          <>
            <div className="ui-page-pad ui-stack">
              <SearchField label="חיפוש פרויקט" value="" onChange={() => undefined} placeholder="חיפוש לפי שם או סטטוס" disabled />
            </div>
            <ListSkeleton />
          </>
        }
      >
        <ProjectsBody
          projects={data?.projects ?? []}
          query={query}
          setQuery={setQuery}
          expanded={expanded}
          setExpanded={setExpanded}
          search={search}
        />
      </ScreenState>
      {sheet}
    </>
  );
}

function projectMargin(project: ProjectRow): ReactNode | undefined {
  const shown = projectMarginHint(project);
  if (shown == null) return undefined;
  return (
    <>
      רווחיות <bdi dir="ltr">{shown}</bdi>
    </>
  );
}

function ProjectsBody({
  projects,
  query,
  setQuery,
  expanded,
  setExpanded,
  search,
}: {
  projects: Dashboard["projects"];
  query: string;
  setQuery: (value: string) => void;
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  search: string;
}) {
  const finished = projects.filter((project) => project.status === "finished");
  const active = projects.filter((project) => project.status !== "finished");
  const needle = query.trim();
  /** Every active project by default; a query searches finished ones too (after the active ones), so none is out of reach. */
  const shown = expanded || needle !== "" ? [...active, ...finished] : active;
  const visible = shown.filter((project) =>
    needle === ""
    || project.name.includes(needle)
    || (project.state_label ?? "").includes(needle)
    // The finished row shows הסתיים, so that word finds it too.
    || (project.status === "finished" && "הסתיים".includes(needle)));
  return (
    <>
      <div className="ui-page-pad ui-stack">
        <SearchField label="חיפוש פרויקט" value={query} onChange={setQuery} placeholder="חיפוש לפי שם או סטטוס" />
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={`לא מצאנו ״${needle}״`}
          body="החיפוש הוא לפי שם או סטטוס. גם פרויקטים שהסתיימו נכללים."
          action={<Button variant="pill" onClick={() => { setQuery(""); }}>ניקוי החיפוש</Button>}
        />
      ) : (
        <List>
          {visible.map((project) => {
            const amounts = projectAmountFigures(project);
            const single = amounts.length === 1 ? amounts[0] : undefined;
            return (
            <ListRow
              key={project.id}
              variant="project"
              title={project.name}
              hint={project.status === "finished" ? "הסתיים" : (projectMargin(project) ?? project.state_label ?? undefined)}
              agorot={single?.minor ?? project.profit_agorot}
              currency={single?.currency}
              amounts={amounts.length > 1 ? amounts : undefined}
              loss={(single?.minor ?? project.profit_agorot) < 0n}
              href={`/projects/${project.id}${search}`}
            />
            );
          })}
        </List>
      )}
      {!expanded && needle === "" && finished.length > 0 ? (
        <p className="ui-page-pad">
          <TextLink tone="quiet" onClick={() => { setExpanded(true); }}>
            {finished.length === 1
              ? "עוד פרויקט אחד שהסתיים"
              : <>עוד <bdi dir="ltr">{String(finished.length)}</bdi> שהסתיימו</>}
          </TextLink>
        </p>
      ) : null}
    </>
  );
}

function ProjectForm({ onClose, projectId }: { onClose: () => void; projectId?: string }) {
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const save = useWrite({
    failure: "לא הצלחנו לשמור את הפרויקט.",
    success: "הפרויקט נשמר",
    keys: ["dashboard", "project"],
    onSuccess: onClose,
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const agorot = budget.trim() === "" ? null : Number(shekelsToAgorot(budget));
      assertNoError(await supabase.rpc("upsert_project", {
        p_name: name,
        p_status: "active",
        ...(projectId ? { p_id: projectId } : {}),
        ...(agorot == null ? {} : { p_budget_agorot: agorot }),
      }));
    },
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (holdWrites || blocked()) return;
    save.mutate();
  }

  return (
    <form className="ui-stack" onSubmit={submit}>
      <TextField label="שם" value={name} onChange={(event) => { setName(event.target.value); }} required />
      <MoneyField label="תקציב בשקלים, או ריק" value={budget} onValueChange={setBudget} />
      <Button type="submit" busy={save.isPending} disabled={holdWrites}>שמירה</Button>
      <Button variant="secondary" onClick={onClose}>ביטול</Button>
    </form>
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function movesShown(state: unknown): boolean {
  return isPlainRecord(state) && state.moves === true;
}

function ReservedMenuSlot() {
  return <span className="ui-menu-slot" aria-hidden="true" />;
}

function ProjectLoading({ search, example }: { search: string; example?: ReactNode }) {
  const holdWrites = useHoldWrites();
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex min-h-full flex-1 flex-col" aria-busy="true">
      <p className="sr-only" role="status">טוען…</p>
      <TopBand
        wordmark={false}
        example={example}
        leading={
          <BackButton fallback={`/projects${search}`} onBand />
        }
        trailing={holdWrites ? <ReservedMenuSlot /> : (
          <IconButton label="עוד" onBand onClick={() => { setMenu(true); }}>
            <MoreIcon />
          </IconButton>
        )}
      >
        <BandHero>
          <div className="ui-project-skel">
            <span className="ui-skel-project-title">
              <Skeleton tone="band" className="ui-skel-project-title-bar" />
            </span>
            <span className="ui-skel-project-period">
              <Skeleton tone="band" className="ui-skel-project-period-bar" />
            </span>
            <Skeleton tone="band" className="ui-skel-project-label" />
            <Skeleton tone="band" className="ui-skel-project-num" />
            <span className="ui-band-figures">
              <Skeleton tone="band" className="ui-skel-project-figure" />
              <Skeleton tone="band" className="ui-skel-project-figure" />
            </span>
          </div>
        </BandHero>
      </TopBand>
      <div className="ui-page-pad ui-stack">
        <Skeleton width="lg" />
        <Skeleton width="md" />
      </div>
      <SectionHead title="הוצאות לפי קטגוריה" />
      <ListSkeleton />
      {holdWrites ? null : (
        <Sheet open={menu} onOpenChange={setMenu} title="עוד">
          <p className="t-hint">הפרויקט עדיין נטען.</p>
        </Sheet>
      )}
    </div>
  );
}

function pendingApprovalTitle(count: number): string {
  return count === 1 ? "1 ממתינה לאישור" : `${String(count)} ממתינות לאישור`;
}

function projectRowProfit(
  project: NonNullable<ProjectDetail>,
  row: ProjectCurrencyRow,
  overheadOn: boolean,
  singleCurrency: boolean,
): bigint {
  if (row.currency === "ILS" && singleCurrency) {
    return shownProfit(
      overheadOn,
      project.overhead_weighted === true,
      project.profit_agorot,
      project.profit_after_overhead_agorot,
    );
  }
  if (row.currency === "ILS" && overheadOn && project.overhead_weighted === true && project.profit_after_overhead_agorot != null) {
    return project.profit_after_overhead_agorot;
  }
  return row.profit_minor;
}

function withParam(search: string, key: string, value: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(key, value);
  return `?${params.toString()}`;
}

/** Confirmed categories, then the amount still waiting, so the lines match the project's expenses. */
function ProjectCategories({
  project,
  search,
  categoryTo,
}: {
  project: NonNullable<ProjectDetail>;
  search: string;
  categoryTo?: string;
}) {
  const pendingOther = project.pending_other_currencies ?? [];
  // pending_count counts every waiting line; the non-ILS ones get their own rows below.
  const pendingOtherCount = pendingOther.reduce((sum, bucket) => sum + bucket.count, 0);
  const pending = Math.max(0, (project.pending_count ?? 0) - pendingOtherCount);
  const waiting = pending > 0;
  const categoryRows = project.categories_by_currency ?? project.categories.map((category) => ({
    currency: "ILS" as const,
    id: category.id,
    name: category.name,
    amount_minor: category.amount_agorot,
    has_shared_share: category.has_shared_share,
  }));
  const grouped = new Map<string, typeof categoryRows>();
  for (const row of categoryRows) {
    const list = grouped.get(row.currency) ?? [];
    list.push(row);
    grouped.set(row.currency, list);
  }
  const currencies = [...grouped.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === "ILS") return -1;
    if (b === "ILS") return 1;
    return a.localeCompare(b);
  });
  const hasCategories = currencies.some((currency) => (grouped.get(currency)?.length ?? 0) > 0);
  if (!hasCategories && !waiting && pendingOther.length === 0) {
    return <p className="ui-page-pad t-hint">אין עדיין הוצאות מסווגות.</p>;
  }
  // The section is titled הוצאות, so the figures carry no minus (FLOW-328).
  return (
    <>
      <List>
      {currencies.flatMap((currency) => (grouped.get(currency) ?? []).map((category) => (
        <ListRow
          key={`${currency}:${category.id ?? category.name ?? ""}`}
          variant="project"
          title={category.name ?? "בלי קטגוריה"}
          agorot={absAgorot(category.amount_minor)}
          currency={currency}
          loss={false}
          chevron={category.id != null}
          href={category.id != null ? (categoryTo ?? categoryHref(project.id, category.id, currency, search)) : undefined}
          wrapHint={category.has_shared_share === true}
          hint={category.has_shared_share === true ? (
            <span className="ui-shared-note t-hint">כולל חלק מהוצאות משותפות</span>
          ) : undefined}
        />
      )))}
      {waiting ? (
        <ListRow
          variant="project"
          title={pendingApprovalTitle(pending)}
          agorot={absAgorot(project.pending_agorot ?? 0n)}
          currency="ILS"
          loss={false}
          chevron
          href={`/review${withParam(search, "project", project.id)}`}
        />
      ) : null}
      {pendingOther.map((bucket) => (
        <ListRow
          key={bucket.currency}
          variant="project"
          title={pendingApprovalTitle(bucket.count)}
          agorot={absAgorot(bucket.expense_minor)}
          currency={bucket.currency}
          loss={false}
          chevron
          href={`/review${withParam(search, "project", project.id)}`}
        />
      ))}
    </List>
    </>
  );
}

export function ProjectDetailScreen({
  sample,
  example,
  categoryTo,
}: {
  sample?: NonNullable<ProjectDetail>;
  example?: ReactNode;
  /** Dev fixtures send a category row here. Production builds the project route. */
  categoryTo?: string;
} = {}) {
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  const detail = useProjectQuery(sample ? "" : projectId);
  const preview = useHomePreview();
  const blocked = useBlockedPreview();
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const location = useLocation();
  const navigate = useNavigate();
  // Kept on the history entry, so Back from a card reopens the list at its scroll spot.
  const [moves, setMoves] = useState(() => movesShown(location.state));
  const [overheadOn, setOverheadOn] = useState(sample?.after_overhead === true);
  const wantedOverhead = useRef(false);
  const heldTransactions = useHeldOrder((sample ?? detail.data)?.transactions ?? [], (txn) => txn.id);
  const heldIds = heldTransactions.map((txn) => txn.id);
  const listFrom = `${location.pathname}${location.search}`;
  const projectMarks = useLoanMarks(heldTransactions.map((txn) => txn.id), sample == null && moves);
  useEffect(() => {
    if (sample) return;
    if (detail.data) setOverheadOn(detail.data.after_overhead === true);
  }, [sample, detail.data]);
  const saveOverhead = useWrite({
    failure: "לא הצלחנו לשמור את התצוגה.",
    keys: ["project", "dashboard"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || projectId === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("set_after_overhead", { p_on: wantedOverhead.current, p_project_id: projectId }));
    },
  });
  const holdWrites = useHoldWrites();
  if (phase.kind === "loading") return <ProjectLoading search={search} example={example} />;
  if (phase.kind === "error") {
    return (
      <ScreenState title="פרויקט" backTo={`/projects${search}`} phase={phase} onRetry={() => { void detail.refetch(); }} />
    );
  }
  if (phase.kind === "empty") return <LegacyEmptyProject />;
  const project = sample ?? detail.data;
  if (!project) {
    return <ScreenHeader title="פרויקט" subtitle="הפרויקט לא נמצא." backTo={`/projects${search}`} />;
  }
  const currencyRows = projectRows(project);
  const singleCurrency = currencyRows.length === 1;
  const profitRows = currencyRows.map((row) => ({
    row,
    profit: projectRowProfit(project, row, overheadOn, singleCurrency),
  }));
  const marginShown = singleCurrency
    ? (() => {
      const row = currencyRows[0];
      if (row == null || row.income_minor <= 0n) return null;
      const profit = profitRows[0]?.profit ?? 0n;
      const margin = Number((profit * 100n) / row.income_minor);
      return margin < 0 ? `−${String(Math.abs(margin))}%` : `${String(margin)}%`;
    })()
    : null;
  const expenses = absAgorot(project.direct_agorot) + absAgorot(project.shared_agorot);
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        example={example}
        leading={
          <BackButton fallback={`/projects${search}`} onBand />
        }
        trailing={holdWrites ? <ReservedMenuSlot /> : <ProjectMenu projectId={project.id} name={project.name} budget={project.budget_agorot ?? null} finished={project.status === "finished"} />}
      >
        <BandHero>
          <FocusTitle className="t-band-title">{project.name}</FocusTitle>
          <p className="t-label">{project.state_label ?? (project.status === "finished" ? "הסתיים" : "פעיל")}</p>
          <p className="ui-band-label t-label">
            רווח
            {marginShown == null ? null : (
              <>
                {" · רווחיות "}
                <bdi dir="ltr">{marginShown}</bdi>
              </>
            )}
          </p>
          <div className="t-display ui-project-profits">
            {profitRows.map(({ row, profit: rowProfit }) => (
              <p key={row.currency}>
                <BigNumber agorot={rowProfit} currency={row.currency} loss={rowProfit < 0n} />
              </p>
            ))}
          </div>
          {currencyRows.map((row) => (
            <BandFigures
              key={row.currency}
              income={formatAmountText(row.income_minor, row.currency)}
              expense={formatAmountText(projectExpenseMinor(row), row.currency)}
            />
          ))}
        </BandHero>
      </TopBand>
      <div className="ui-page-pad ui-project-overhead">
        <Toggle
          label="אחרי חלק בהוצאות כלליות"
          hint={overheadHint(overheadOn, {
            available: project.overhead_weighted === true,
            shareAgorot: project.overhead_share_agorot,
          })}
          checked={overheadOn}
          disabled={holdWrites}
          onChange={(checked) => {
            if (holdWrites) return;
            if (sample) {
              setOverheadOn(checked);
              return;
            }
            if (blocked()) return;
            const previous = overheadOn;
            setOverheadOn(checked);
            wantedOverhead.current = checked;
            saveOverhead.mutate(undefined, { onError: () => { setOverheadOn(previous); } });
          }}
        />
      </div>
      {project.budget_agorot != null ? (
        <div className="ui-page-pad">
          <BudgetBar label="תקציב" spentAgorot={expenses} budgetAgorot={project.budget_agorot} />
        </div>
      ) : null}
      {(project.loans ?? []).length > 0 ? (
        <>
          <SectionHead title="הלוואות" />
          <ProjectLoanList rows={project.loans ?? []} />
        </>
      ) : null}
      <SectionHead title="הוצאות לפי קטגוריה" />
      <ProjectCategories
        project={project}
        search={search}
        categoryTo={categoryTo == null ? undefined : `${categoryTo}${search}`}
      />
      <p className="ui-page-pad ui-page-title-row">
        <TextLink to={`/settings/categories${search}`} tone="quiet">כל הקטגוריות</TextLink>
        <TextLink
          tone="accent"
          onClick={() => {
            setMoves(true);
            void navigate(`${location.pathname}${location.search}${location.hash}`, {
              replace: true,
              state: { ...(isPlainRecord(location.state) ? location.state : {}), moves: true },
            });
          }}
        >
          תנועות אחרונות
        </TextLink>
      </p>
      {moves ? (
        heldTransactions.length === 0 ? (
          <EmptyState icon={<DocumentIcon />} title="אין עדיין תנועות" body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן." />
        ) : (
          <MonthList
            rows={heldTransactions}
            keyOf={(txn) => txn.id}
            dateOf={(txn) => txn.doc_date}
            amountOf={(txn) => ({ minor: txn.kept_out === true ? 0n : txn.amount_net, currency: txn.currency ?? "ILS", direction: txn.direction === "income" ? "income" : "expense" })}
            complete={heldTransactions.length < PROJECT_RECENT_CAP}
            renderRow={(txn) => (
              <ListRow
                variant="transaction"
                title={txn.description}
                {...loanRowProps(projectMarks.get(txn.id), `${txn.category ? `${txn.category} · ` : ""}${formatDayMonth(txn.doc_date)}`)}
                agorot={txn.amount_net}
                sign={txn.direction === "income" ? "in" : "out"}
                currency={txn.currency ?? "ILS"}
                source="invoice"
                href={`/transactions/${txn.id}${search}`}
                state={txnListState(heldIds, txn.id, listFrom)}
              />
            )}
          />
        )
      ) : null}
    </div>
  );
}

function LegacyEmptyProject() {
  const search = usePreviewSearch();
  const location = useLocation();
  const holdWrites = useHoldWrites();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        leading={
          <BackButton fallback={`/projects${search}`} onBand />
        }
      >
        <BandHero>
          <FocusTitle className="t-band-title">פרויקט</FocusTitle>
          <p className="ui-band-label t-label">רווח</p>
          <p className="t-display"><BigNumber agorot={0n} /></p>
        </BandHero>
      </TopBand>
      <EmptyState
        icon={<DocumentIcon />}
        title="אין עדיין תנועות"
        body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן."
        action={holdWrites ? undefined : (
          <Button variant="pill" to={`/add${search}`} state={withSheetBackground(location)}>
            <CameraIcon />
            צילום חשבונית
          </Button>
        )}
      />
    </div>
  );
}

function ProjectMenu({
  projectId,
  name,
  budget,
  finished,
}: {
  projectId: string;
  name: string;
  budget: bigint | null;
  finished: boolean;
}) {
  const blocked = useBlockedPreview();
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const save = useWrite({
    failure: "לא הצלחנו לעדכן את הפרויקט.",
    success: finished ? "הפרויקט חזר לפעיל" : "הפרויקט סומן כהסתיים",
    keys: ["dashboard", "project"],
    onSuccess: () => { setConfirm(false); },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("upsert_project", {
        p_id: projectId,
        p_name: name,
        ...(budget == null ? {} : { p_budget_agorot: Number(budget) }),
        p_status: finished ? "active" : "finished",
      }));
    },
  });
  return (
    <>
      <IconButton
        label="עוד"
        onBand
        onClick={() => {
          setMenu(true);
        }}
      >
        <MoreIcon />
      </IconButton>
      <Sheet open={menu} onOpenChange={setMenu} title="עוד">
        <Button
          variant="secondary"
          onClick={() => {
            setMenu(false);
            setConfirm(true);
          }}
        >
          {finished ? "החזרה לפעיל" : "סיום הפרויקט"}
        </Button>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={finished ? "להחזיר את הפרויקט לפעיל?" : "לסיים את הפרויקט?"}
        item={name}
        consequence="פרויקט לא נמחק. אפשר להחזיר אותו אחר כך."
        confirmLabel="אישור"
        destructive={!finished}
        busy={save.isPending}
        onConfirm={() => {
          if (blocked()) return;
          save.mutate();
        }}
      />
    </>
  );
}

/** Dev-only rows so the review banner can open a list that has a transaction. */
function devFiledFixture(sampleFlag: string | null): FiledTodayRow[] | undefined {
  if (!import.meta.env.DEV || sampleFlag !== "1") return undefined;
  return [{
    id: "t-filed",
    description: "מלט",
    doc_date: "2026-09-29",
    amount_net: -350_000n,
    direction: "expense",
    supplier_name: "מנופי המרכז בע״מ",
    project_name: "שיפוץ הרצל 12",
    category_name: "חומרים",
  }];
}

export function FiledTodayScreen({
  sample,
  backTo,
  rowHref,
}: {
  sample?: FiledTodayRow[];
  /** Overrides the queue as the parent. The reviewer preview uses its own index. */
  backTo?: string;
  /** Overrides the transaction route. The reviewer preview stays on sample screens. */
  rowHref?: (row: FiledTodayRow) => string;
} = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const [params] = useSearchParams();
  const fixture = devFiledFixture(params.get("sample"));
  const shown = sample ?? fixture;
  const filed = useFiledTodayQuery(shown == null);
  const phase = shown ? ({ kind: "ready" } as const) : screenPhase(preview, filed);
  const rows = useHeldOrder(shown ?? filed.data ?? [], (row) => row.id);
  const location = useLocation();
  const rowIds = rows.map((row) => row.id);
  const filedMarks = useLoanMarks(rows.map((row) => row.id), shown == null);
  return (
    <ScreenState
      title="שויכו היום"
      backTo={backTo ?? `/review${search}`}
      phase={phase.kind === "ready" && rows.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void filed.refetch(); }}
      empty={<EmptyState icon={<ReviewIcon />} title={FILED_TODAY_EMPTY_TITLE} body={FILED_TODAY_EMPTY_BODY} />}
    >
      <List>
        {rows.map((row) => (
          <ListRow
            key={row.id}
            variant="transaction"
            title={row.supplier_name ?? row.description}
            {...loanRowProps(filedMarks.get(row.id), [row.project_name, row.category_name].filter((part) => part != null && part !== "").join(" · "))}
            agorot={row.amount_net}
            sign={row.direction === "income" ? "in" : "out"}
            source="invoice"
            href={rowHref ? rowHref(row) : `/transactions/${row.id}${search}`}
            state={rowHref ? undefined : txnListState(rowIds, row.id, `${location.pathname}${location.search}`)}
          />
        ))}
      </List>
    </ScreenState>
  );
}

/** get_project returns at most this many recent transactions, so a full page may hide older rows of its last month. */
const PROJECT_RECENT_CAP = 40;

const EMPTY_REVIEW: ReviewRow[] = [];

/** The row opened from the list. A later URL replace must not move this. */
let reviewReturnId: string | null = null;

/** The card line that opened the picker. The sheet focuses it after close. */
export const reviewLineFocus: {
  project: { current: HTMLButtonElement | null };
  category: { current: HTMLButtonElement | null };
} = {
  project: { current: null },
  category: { current: null },
};

export function resetReviewListFocus(): void {
  reviewReturnId = null;
  reviewLineFocus.project.current = null;
  reviewLineFocus.category.current = null;
}

/** Dev-only fixture. A production build folds this to null and drops the module. */
const reviewE2e = import.meta.env.DEV ? reviewE2eFixture : null;

function useE2eReviewRows(active: boolean): ReviewRow[] {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!import.meta.env.DEV || !active || reviewE2e == null) return;
    return reviewE2e.subscribe(() => {
      bump((n) => n + 1);
    });
  }, [active]);
  if (!import.meta.env.DEV || !active || reviewE2e == null) return EMPTY_REVIEW;
  return reviewE2e.currentRows();
}

export function reviewListPath(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete("item");
  params.delete("from");
  params.delete("pick");
  params.delete("list");
  const text = params.toString();
  return text === "" ? "/review/all" : `/review/all?${text}`;
}

export function reviewFocusPath(search: string, id: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.delete("pick");
  params.delete("list");
  params.set("item", id);
  params.set("from", "all");
  return `/review?${params.toString()}`;
}

export function rotateReview<T extends { id: string }>(rows: T[], id: string): T[] {
  const index = rows.findIndex((row) => row.id === id);
  if (index <= 0) return rows;
  return [...rows.slice(index), ...rows.slice(0, index)];
}

/** Keeps a card opened from the list, then the item that followed it once that card leaves. */
export function queueAfterFocus<T extends { id: string }>(
  rows: T[],
  focusId: string,
  prior: readonly T[] | null,
): { rows: T[]; order: T[] } {
  if (rows.some((row) => row.id === focusId)) {
    const order = rotateReview(rows, focusId);
    return { rows: order, order };
  }
  const index = prior?.findIndex((row) => row.id === focusId) ?? -1;
  const rest = prior == null || index < 0 ? [] : [...prior.slice(index + 1), ...prior.slice(0, index)];
  const nextId = rest.find((row) => rows.some((item) => item.id === row.id))?.id;
  const order = nextId ? rotateReview(rows, nextId) : rows;
  return { rows: order, order };
}

/** The list card under a line picker. from=all opens it; list=all keeps it while the picker is open. */
function listFocusId(params: URLSearchParams): string | null {
  const item = params.get("item");
  if (item == null || item === "") return null;
  if (params.get("from") === "all" || params.get("list") === "all") return item;
  return null;
}

function assignmentPath(
  changeTo: string | undefined,
  search: string,
  id: string,
  pick?: "project" | "category",
  fromList = false,
  fromLine = false,
): string {
  const base = changeTo ?? `/review/change${search}`;
  const [path, query = ""] = base.split("?");
  const params = new URLSearchParams(query);
  params.set("item", id);
  if (pick) params.set("pick", pick);
  else params.delete("pick");
  if (fromLine) {
    params.set("from", "line");
    if (fromList) params.set("list", "all");
    else params.delete("list");
  } else if (fromList) {
    params.set("from", "all");
    params.delete("list");
  }
  return `${String(path)}?${params.toString()}`;
}

export function ReviewScreen() {
  const preview = useHomePreview();
  const search = useFlowSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const holdWrites = useHoldWrites();
  const listing = location.pathname === "/review/all";
  const projectFilter = params.get("project");
  const review = useReviewQuery();
  const waiting = useProjectWaitingQuery(projectFilter ?? "");
  const focusedOrder = useRef<ReviewRow[] | null>(null);
  const e2eList = reviewE2e != null && params.get("preview") != null && params.get("e2e") === "list";
  const e2eRows = useE2eReviewRows(e2eList);
  const phase = e2eList ? ({ kind: "ready" } as const) : screenPhase(preview, review);
  const source = e2eList ? e2eRows : (review.data ?? EMPTY_REVIEW);
  const activeRows = useMemo(() => {
    if (projectFilter == null || preview !== "off") return source;
    const held = waiting.data;
    if (held == null || held.length === 0 || !held.every((row) => row.review_id != null)) return source;
    const ids = new Set(held.map((row) => row.review_id));
    return source.filter((row) => ids.has(row.id));
  }, [projectFilter, preview, source, waiting.data]);
  useEffect(() => {
    if (location.pathname !== "/review") {
      if (listing) focusedOrder.current = null;
      return;
    }
    const urlId = listFocusId(params);
    if (urlId == null) {
      focusedOrder.current = null;
      return;
    }
    if (reviewReturnId == null) reviewReturnId = urlId;
    if (phase.kind !== "ready") return;
    if (activeRows.length === 0) {
      if (projectFilter == null) void navigate(`/review${search}`, { replace: true });
      return;
    }
    if (activeRows.some((row) => row.id === urlId)) {
      focusedOrder.current = rotateReview(activeRows, urlId);
      return;
    }
    const head = queueAfterFocus(activeRows, urlId, focusedOrder.current).rows[0]?.id;
    if (head != null && head !== urlId) void navigate(reviewFocusPath(search, head), { replace: true });
  }, [location.pathname, listing, params, activeRows, phase.kind, search, navigate, projectFilter]);
  function rowsForFocus(rows: ReviewRow[]): ReviewRow[] {
    const urlId = listFocusId(params);
    if (listing || urlId == null) return rows;
    if (rows.some((row) => row.id === urlId)) return rotateReview(rows, urlId);
    return queueAfterFocus(rows, urlId, focusedOrder.current).rows;
  }
  const e2eWrite: ReviewPreviewWrite | undefined = reviewE2e != null && e2eList
    ? reviewE2e.e2ePreviewWrite()
    : undefined;
  if (projectFilter != null && preview === "off") {
    const back = `/projects/${projectFilter}`;
    const waitingPhase = screenPhase(preview, waiting);
    if (waitingPhase.kind === "loading" || waitingPhase.kind === "error") {
      return <ScreenState title="לאישור" backTo={back} phase={waitingPhase} onRetry={() => { void waiting.refetch(); }} />;
    }
    const held = waiting.data ?? [];
    if (held.length === 0) return <ReviewEmpty search={search} filtered backTo={back} homeTo={back} homeLabel="חזרה לפרויקט" />;
    if (held.every((row) => row.review_id != null)) {
      if (phase.kind !== "ready") {
        return <ScreenState title="לאישור" backTo={back} phase={phase} onRetry={() => { void review.refetch(); }} />;
      }
      const ids = new Set(held.map((row) => row.review_id));
      const rows = source.filter((row) => ids.has(row.id));
      if (rows.length === 0) return <ReviewEmpty search={search} filtered backTo={back} homeTo={back} homeLabel="חזרה לפרויקט" />;
      if (listing) return <ReviewAllList rows={rows} search={search} backTo={`/review${search}`} skipped={false} />;
      const fromList = listFocusId(params) != null;
      const ordered = rowsForFocus(rows);
      return (
        <ReviewQueue
          rows={ordered}
          search={search}
          listPlace={listPlace(rows, ordered, fromList)}
          backTo={fromList ? reviewListPath(search) : back}
          homeTo={back}
          homeLabel="חזרה לפרויקט"
        />
      );
    }
    return <ProjectWaitingList rows={held} search={search} backTo={back} />;
  }
  const rows = source;
  const fromList = listFocusId(params) != null;
  if (!listing && !holdWrites && params.get("setup") === "1" && (phase.kind === "empty" || (phase.kind === "ready" && rows.length === 0))) {
    const fromCard = params.get("from") === "card";
    return (
      <SetupSampleReview
        backTo={fromCard ? "/setup/4?from=card" : "/setup/4"}
        continueTo={fromCard ? "/" : "/setup/5"}
        empty={<ReviewEmpty search={search} backTo={fromList ? `/review${search}` : undefined} />}
      />
    );
  }
  if (phase.kind === "empty" || (phase.kind === "ready" && rows.length === 0)) {
    // FLOW-309: הצג הכול still lists the skipped cards when nothing waits.
    if (listing) return <ReviewAllList rows={EMPTY_REVIEW} search={search} backTo={`/review${search}`} />;
    return <ReviewEmpty search={search} backTo={fromList ? `/review${search}` : undefined} skippedLink />;
  }
  if (phase.kind !== "ready") {
    return <ScreenState title="לאישור" phase={phase} onRetry={() => { void review.refetch(); }} backTo={listing ? `/review${search}` : undefined} />;
  }
  if (listing) return <ReviewAllList rows={rows} search={search} backTo={`/review${search}`} />;
  const ordered = rowsForFocus(rows);
  const setupRun = params.get("setup") === "1";
  const setupFromCard = params.get("from") === "card";
  return (
    <ReviewQueue
      rows={ordered}
      search={search}
      previewWrite={e2eWrite}
      listPlace={listPlace(rows, ordered, fromList)}
      backTo={fromList ? reviewListPath(search) : undefined}
      setupHandoff={setupRun ? { fromCard: setupFromCard } : undefined}
    />
  );
}

function listPlace(rows: ReviewRow[], ordered: ReviewRow[], fromList: boolean): { index: number; total: number } | undefined {
  if (!fromList) return undefined;
  const head = ordered[0];
  if (!head) return undefined;
  const index = rows.findIndex((row) => row.id === head.id);
  if (index < 0) return undefined;
  return { index: index + 1, total: rows.length };
}

export function ReviewAllList({
  rows,
  search,
  backTo,
  skipped = true,
}: {
  rows: ReviewRow[];
  search: string;
  backTo: string;
  /** FLOW-309: the דולגו section at the end. A project's list leaves it out. */
  skipped?: boolean;
}) {
  useEffect(() => {
    const id = reviewReturnId;
    if (id == null) return;
    const href = reviewFocusPath(search, id);
    const link = [...document.querySelectorAll("a[href]")].find((node) => node.getAttribute("href") === href);
    if (link instanceof HTMLElement) link.focus();
    const timer = window.setTimeout(() => {
      if (reviewReturnId === id) reviewReturnId = null;
    }, 0);
    return () => { window.clearTimeout(timer); };
  }, [search, rows]);
  const ordered = useHeldOrder(rows, (row) => row.id);
  // FLOW-305: one bank-details read for the bank lines on this page. A failed read keeps "בנק".
  const bankIds = useMemo(() => rows.filter((row) => row.source === "mercury").map((row) => row.transaction_id), [rows]);
  const lineMeta = useLineMetaPageQuery(bankIds);
  const skippedRead = useSkippedReviewQuery(skipped && rows.length === 0);
  const cardPath = useCallback((id: string) => reviewFocusPath(search, id), [search]);
  if (rows.length === 0) {
    const someSkipped = skipped && (skippedRead.isError || (skippedRead.data?.length ?? 0) > 0);
    // FLOW-327 r1: while the skipped read loads, the page says nothing waits rather than הכל מאושר,
    // which would flip to this layout once skipped rows land.
    const skippedLoading = skipped && skippedRead.isLoading;
    if (!someSkipped && !skippedLoading) return <ReviewEmpty search={search} backTo={backTo} />;
    return (
      <div>
        <ScreenHeader title="לאישור" subtitle="תנועות שמחכות לשיוך" backTo={backTo} layout="inline" />
        <p className="t-hint ui-page-pad ui-review-none-waiting">{REVIEW_NONE_WAITING}</p>
        <ReviewSkippedSection search={search} cardPath={cardPath} />
      </div>
    );
  }
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="תנועות שמחכות לשיוך" backTo={backTo} layout="inline" />
      <MonthList
        rows={ordered}
        keyOf={(row) => row.id}
        dateOf={(row) => row.doc_date}
        amountOf={(row) => ({ minor: row.amount_net, currency: row.currency ?? "ILS", direction: row.direction })}
        days
        cents
        renderRow={(row) => (
          <ListRow
            variant="statement"
            title={row.supplier_name ?? row.description}
            fallback={row.source === "mercury" ? "bank" : "invoice"}
            method={statementMethodOf(row.source, row.doc_kind, lineMeta.data?.get(row.transaction_id))}
            suggestion={statementSuggestion(row)}
            pending={row.line_status === "pending"}
            agorot={row.amount_net}
            currency={row.currency}
            sign={row.direction === "income" ? "in" : "out"}
            href={reviewFocusPath(search, row.id)}
          />
        )}
      />
      {skipped ? <ReviewSkippedSection search={search} cardPath={cardPath} /> : null}
    </div>
  );
}

/** הצג הכול with nothing waiting, above the skipped section. */
export const REVIEW_NONE_WAITING = "אין פריטים שמחכים לאישור.";

/** "project · category" for the statement row's ✦ line: what the card shows (U11). FLOW-305. */
export function statementSuggestion(row: ReviewRow): string | null {
  const suggestion = reviewSuggestion(row);
  if (suggestion == null) return null;
  return [suggestion.project, suggestion.category].filter((part) => part != null).join(" · ");
}

export function ProjectWaitingList({
  rows,
  search,
  backTo,
  hrefFor,
}: {
  rows: ProjectWaitingRow[];
  search: string;
  backTo?: string;
  hrefFor?: (row: ProjectWaitingRow) => string;
}) {
  const ordered = useHeldOrder(rows, (row) => row.transaction_id);
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="הוצאות שמחכות לאישור בפרויקט הזה" backTo={backTo} layout="inline" />
      <MonthList
        rows={ordered}
        keyOf={(row) => row.transaction_id}
        dateOf={(row) => row.doc_date}
        amountOf={(row) => ({ minor: row.amount_net, currency: "ILS", direction: "expense" })}
        renderRow={(row) => (
          <ListRow
            variant="transaction"
            title={row.description}
            hint={formatDayMonth(row.doc_date)}
            agorot={row.amount_net}
            sign="out"
            source="invoice"
            href={hrefFor
              ? hrefFor(row)
              : row.review_id == null
                ? `/transactions/${row.transaction_id}${search}`
                : `/review/change${search}${search ? "&" : "?"}item=${row.review_id}`}
          />
        )}
      />
    </div>
  );
}

export type ReviewPreviewWrite = {
  run: () => Promise<void>;
  onDone: (id: string) => void;
  onUndo: (id: string) => void;
};

function reviewFlagKey(value: boolean | undefined): string {
  if (value === true) return "1";
  if (value === false) return "0";
  return "";
}

function reviewMotionKey(row: ReviewRow | null): string {
  if (row == null) return "";
  return [
    row.id,
    row.category_id ?? "",
    row.category_name ?? "",
    reviewFlagKey(row.category_suggested),
    reviewFlagKey(row.project_suggested),
    row.project_name ?? "",
    String(row.share_count ?? ""),
    String(row.auto_approved_today ?? ""),
  ].join("\u0000");
}

export function ReviewQueue({
  rows: incoming,
  search,
  sample = false,
  previewWrite,
  changeTo,
  filedTo,
  backTo,
  homeTo,
  homeLabel,
  onShared,
  listPlace,
  setupHandoff,
}: {
  rows: ReviewRow[];
  search: string;
  sample?: boolean;
  setupHandoff?: { fromCard: boolean };
  /** Injected by the dev and reviewer previews. The hosted queue does not set it. */
  previewWrite?: ReviewPreviewWrite;
  /** Preview sends שינוי to its own save screen. */
  changeTo?: string;
  /** Preview sends צפייה to its own filed list. */
  filedTo?: string;
  backTo?: string;
  /** A card opened from the list. Position in the remaining queue, not visit progress. */
  listPlace?: { index: number; total: number };
  /** Preview returns an empty queue to its index. */
  homeTo?: string;
  /** Label for that return. The product queue says לדף הבית. */
  homeLabel?: string;
  /** Preview opens its own split instead of the ledger split. */
  onShared?: (transactionId: string) => void;
}) {
  const preview = useHomePreview();
  const navigate = useNavigate();
  const [queueParams] = useSearchParams();
  const fromList = listFocusId(queueParams) != null;
  const toast = useToast();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const invalidate = useInvalidateBooks();
  const kindRows = useCategoriesQuery(!sample && preview === "off" && previewWrite == null).data;
  const held = useHeldOrder(incoming, (item) => item.id);
  // The card on screen stays the head until it is handled, so a refetch that reorders the
  // queue can't swap another line under אישור. A card opened from the list keeps its focus.
  const rows = fromList ? held : pinReviewHead(held, reviewPin());
  const [hideAuto, setHideAuto] = useState(false);
  const [shown, setShown] = useState<ReviewRow | null>(rows[0] ?? null);
  useEffect(() => {
    // While ביטול holds the undone line, this pin of another card is ignored (review-pin.ts).
    if (!fromList && shown != null) pinReviewLine(shown.transaction_id);
  }, [fromList, shown]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  // A hold names a line this queue was bringing back; it does not outlive the queue.
  useEffect(() => () => { releaseReviewHold(reviewHold()); }, []);
  /** ביטול's reopen failed: drop the hold and pin the card that stayed on screen. */
  const undoFailed = useCallback((line: string | null) => {
    releaseReviewHold(line);
    if (!fromList && shownRef.current != null) pinReviewLine(shownRef.current.transaction_id);
  }, [fromList]);
  const jevQueue = useJevQueue(
    rows.map((item) => item.transaction_id),
    !sample && preview === "off" && previewWrite == null,
  );
  const shownId = (shown ?? rows[0])?.transaction_id ?? null;
  const jevLoading = jevQueue.loadingFor(shownId);
  const metaLive = !sample && previewWrite == null;
  const lineMeta = useLineMetaQuery(shownId, metaLive);
  // Warm the next card's bank details so its meta line paints with the card.
  useLineMetaQuery(rows.find((item) => item.transaction_id !== shownId)?.transaction_id, metaLive);
  const jev = jevQueue.stateFor(shownId);
  const flagsFor = useReviewFlags(
    rows.map((item) => item.transaction_id),
    !sample && preview === "off" && previewWrite == null,
  );
  const [motion, setMotion] = useState<"still" | "out" | "in">("still");
  const visit = useRef(emptyVisit());
  const approvedId = useRef<string | null>(null);
  const approvedLine = useRef<string | null>(null);
  const skippedId = useRef<string | null>(null);
  const skippedLine = useRef<string | null>(null);
  const approveSlot = useRef<HTMLDivElement>(null);
  const approveGuard = useRef(false);
  const setupHandoffShown = useRef(false);
  const [, bumpVisit] = useState(0);
  const openIds = rows.map((item) => item.id);
  const present = notePresence(visit.current, openIds);
  if (present !== visit.current) visit.current = present;
  function markHandled(id: string) {
    visit.current = noteHandled(visit.current, id);
    bumpVisit((value) => value + 1);
  }
  const leaving = motion === "out";
  const nextCard = rows[0] ?? null;
  const nextCardRef = useRef(nextCard);
  nextCardRef.current = nextCard;
  // The head's identity is the swap. A fresh array for the same item must not
  // cancel the card that is already on its way in.
  const motionKey = reviewMotionKey(nextCard);
  useEffect(() => {
    const next = nextCardRef.current;
    if (next?.id === shown?.id) {
      if (
        next != null
        && shown != null
        && (next.category_name !== shown.category_name
          || next.category_id !== shown.category_id
          || next.category_suggested !== shown.category_suggested
          || next.project_suggested !== shown.project_suggested
          || next.project_name !== shown.project_name
          || next.share_count !== shown.share_count
          || next.auto_approved_today !== shown.auto_approved_today)
      ) {
        setShown(next);
      }
      return;
    }
    if (!shown) {
      setShown(next);
      setMotion("still");
      return;
    }
    setMotion("out");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      const landed = nextCardRef.current;
      setShown(landed);
      setMotion(landed ? "in" : "still");
    }, reduce ? 0 : 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [motionKey, shown]);
  const approve = useWrite({
    failure: (error) => {
      if (previewWrite) return changeSaveFailure(error);
      if (error instanceof ApproveNotice) return { message: error.message, tone: "info", retry: false };
      if (isApproveRetry(error) || isTransientWriteError(error)) return { message: "לא הצלחנו לאשר.", retry: true };
      return { message: "לא הצלחנו לאשר.", retry: false };
    },
    place: "bar",
    keys: ["review", "dashboard", "unpaid", "project", "project-category", "project-waiting", "filed-today", "txn"],
    retryFocus: () => {
      approveSlot.current?.querySelector("button")?.focus();
    },
    run: async () => {
      const target = shown;
      approvedId.current = target?.id ?? null;
      approvedLine.current = target?.transaction_id ?? null;
      if (previewWrite) {
        await previewWrite.run();
        if (target) markHandled(target.id);
        return;
      }
      if (!target) throw new Error("missing");
      const filled = withJev(target, jev);
      if (!filled.category_id) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      if (reviewIsSplit(filled) && filled.reason !== "unallocated_shared") {
        if (filled.category_id !== target.category_id && target.transaction_id) {
          assertNoError(await supabase.rpc("set_transaction_category", {
            p_id: target.transaction_id,
            p_category_id: filled.category_id,
            p_resolve: false,
          }));
        }
        assertNoError(await supabase.rpc("approve_split_review", { p_id: filled.id }));
        markHandled(filled.id);
        return;
      }
      if (!filled.project_id) throw new Error("missing");
      const result = await supabase.rpc("approve_review_item", {
        p_id: filled.id,
        p_project_id: filled.project_id,
        p_category_id: filled.category_id,
        p_remember: false,
        p_check_shown: true,
        ...(target.project_id == null ? {} : { p_shown_project_id: target.project_id }),
        ...(target.category_id == null ? {} : { p_shown_category_id: target.category_id }),
      });
      assertNoError(result);
      const outcome = readApproveOutcome(result.data);
      if (outcome === "stale" || outcome === "already_closed") {
        await invalidate([...LEDGER_FOCUS_KEYS]);
        throw new ApproveNotice(outcome);
      }
      if (outcome === "not_found") {
        await invalidate([...LEDGER_FOCUS_KEYS]);
        throw new Error("not_found");
      }
      if (outcome !== "ok") throw new Error("refused");
      markHandled(target.id);
    },
    onSuccess: () => {
      const id = approvedId.current;
      if (!id) return;
      // ביטול brings the undone card back to the front.
      const line = approvedLine.current;
      if (previewWrite) {
        previewWrite.onDone(id);
        toast.show({
          message: "הפריט אושר",
          action: "ביטול",
          place: "bar",
          onAction: () => {
            pinReviewLine(line, { hold: true });
            previewWrite.onUndo(id);
          },
        });
        return;
      }
      if (setupHandoff != null && !setupHandoffShown.current) {
        setupHandoffShown.current = true;
        toast.show({
          message: SAMPLE_TOAST,
          action: "המשך",
          place: "bar",
          onAction: () => {
            void navigate(setupHandoff.fromCard ? "/" : "/setup/5");
          },
        });
        return;
      }
      toast.show({
        message: "הפריט אושר",
        action: "ביטול",
        place: "bar",
        onAction: () => {
          pinReviewLine(line, { hold: true });
          void reopenReview(id, invalidate, toast, undefined, { line, failed: undoFailed });
        },
      });
    },
  });
  const skip = useWrite({
    failure: previewWrite ? changeSaveFailure : "לא הצלחנו לדלג.",
    keys: ["review", "review-skipped", "project", "project-category", "project-waiting"],
    place: "bar",
    run: async () => {
      // The card on screen, like אישור; rows[0] can differ while the queue reorders.
      const target = shown;
      skippedId.current = target?.id ?? null;
      skippedLine.current = target?.transaction_id ?? null;
      if (previewWrite) {
        await previewWrite.run();
        if (target) markHandled(target.id);
        return;
      }
      if (!target) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: target.id,
        p_action: "skipped",
      }));
      markHandled(target.id);
    },
    onSuccess: () => {
      const id = skippedId.current;
      if (!id) return;
      if (previewWrite) previewWrite.onDone(id);
      // ביטול puts the skipped card back at the front (Eliran 2026-10-08: list + undo).
      const line = skippedLine.current;
      toast.show({
        message: "דילגנו על הפריט",
        action: "ביטול",
        place: "bar",
        onAction: () => {
          pinReviewLine(line, { hold: true });
          if (previewWrite) {
            previewWrite.onUndo(id);
            return;
          }
          void reopenReview(id, invalidate, toast, "הפריט חזר לתור.", { line, failed: undoFailed });
        },
      });
    },
  });
  // FLOW-333 C8: the part count, read for a split_mismatch card only.
  const mismatchLine = shown?.reason === "split_mismatch" ? shown.transaction_id : "";
  const splitRead = useLineSplitQuery(mismatchLine, mismatchLine !== "" && !sample && previewWrite == null);
  const splitParts: number | "loading" | undefined = splitRead.data != null
    ? splitRead.data.parts.length
    : splitRead.isPending && splitRead.fetchStatus === "fetching" ? "loading" : undefined;
  const card = shown;
  if (!card) return <ReviewEmpty search={search} homeTo={homeTo} homeLabel={homeLabel} backTo={backTo} skippedLink={homeTo == null && !sample && previewWrite == null} />;
  const current = card;
  const change = assignmentPath(changeTo, search, current.id, undefined, fromList);
  function openProject() {
    if (reviewIsSplit(current)) {
      if (!current.transaction_id) return;
      if (onShared) {
        onShared(current.transaction_id);
        return;
      }
      void navigate(`/transactions/${current.transaction_id}/split${search}`);
      return;
    }
    void navigate(assignmentPath(changeTo, search, current.id, "project", fromList, true));
  }
  function openCategory() {
    void navigate(assignmentPath(changeTo, search, current.id, "category", fromList, true));
  }
  const auto = card.auto_approved_today ?? 0;
  const view = withJev(card, jev);
  const suggestion = reviewSuggestion(
    view,
    isReversal(kindRows ?? [], view.category_id, view.direction === "income" ? "income" : "expense"),
    jevShown(card, jev),
  );
  // FLOW-703: Jev's "no project / overhead" shows on an empty project row; it fills nothing.
  const shownSuggestion = jev.prefill?.noProject === true && view.project_id == null && !reviewIsSplit(view)
    && view.reason !== "unallocated_shared" && view.reason !== "split_mismatch"
    ? { ...(suggestion ?? {}), projectNoneJev: true }
    : suggestion;
  const place = visitPlace(visit.current, openIds);
  const total = listPlace?.total ?? place.total;
  const index = listPlace?.index ?? place.index;
  const splitCard = reviewIsSplit(view);
  const needProject = view.reason !== "unallocated_shared" && !splitCard && view.project_id == null;
  const needCategory = view.reason !== "unallocated_shared" && view.category_id == null;
  const settled = !leaving && !jevLoading;
  const nextPick = settled ? (needProject ? "project" : needCategory ? "category" : null) : null;
  const approvable = settled && nextPick == null && (view.reason === "unallocated_shared"
    || (splitCard ? view.category_id != null : view.project_id != null && view.category_id != null));
  const approveLabel = nextPick === "project" ? "בחירת פרויקט" : nextPick === "category" ? "בחירת קטגוריה" : "אישור";
  // FLOW-327 1.5: with both fields missing the card says why, and the button points at it.
  const missingBoth = settled && needProject && needCategory;
  // FLOW-333 C2: a split whose bank amount changed leads with עדכון הפיצול; להשאיר כך approves it as it stands.
  const mismatch = card.reason === "split_mismatch";
  const jevWhy = jev.prefill?.why == null ? null : jevReasonText(jev.prefill.why, card.direction, reviewHasParty(card));
  const flag = reviewFlagView(flagsFor(card.transaction_id), { direction: card.direction, currency: card.currency });
  function runApprove() {
    if (approveGuard.current || !settled) return;
    if (nextPick === "project") {
      openProject();
      return;
    }
    if (nextPick === "category") {
      openCategory();
      return;
    }
    if (!approvable) return;
    if (previewWrite == null && blocked(sample ? "empty" : preview)) return;
    if (current.reason === "unallocated_shared") {
      if (!current.transaction_id) return;
      if (onShared) {
        onShared(current.transaction_id);
        return;
      }
      void navigate(`/transactions/${current.transaction_id}/split${search}`);
      return;
    }
    approveGuard.current = true;
    approve.mutate(undefined, {
      onSettled: () => {
        approveGuard.current = false;
      },
    });
  }
  const skipButton = (
    <Button
      variant="ghost"
      busy={skip.isPending}
      disabled={leaving || approve.isPending}
      onClick={() => {
        if (leaving) return;
        if (previewWrite == null && blocked(sample ? "empty" : preview)) return;
        skip.mutate();
      }}
    >
      דלג
    </Button>
  );
  return (
    <ViewerScope>
    <div className="ui-review-queue" data-bar={holdWrites ? undefined : ""}>
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" backTo={backTo} layout="inline" />
      {rows.length > 0 ? (
        <div className="ui-review-meter">
          {/* FLOW-327 r1: on the start side, near the thumb. A card opened from the list leaves it
              out: Back already goes to the list. */}
          {changeTo == null && listPlace == null ? (
            <TextLink className="ui-review-show-all" to={reviewListPath(search)} chevron={false}>הצג הכול</TextLink>
          ) : null}
          {listPlace == null ? (
            <ProgressBar
              variant="thin"
              label="התקדמות התור"
              value={index}
              max={total}
            />
          ) : null}
          {holdWrites ? null : <span className="sr-only">פריט </span>}
          <span className="t-hint ui-review-counter">
            {holdWrites ? (
              <bdi className="ui-num ui-review-count" dir="ltr">{String(total)}</bdi>
            ) : (
              <>
                <bdi className="ui-num ui-review-count" dir="ltr">{String(index)}</bdi>
                {" מתוך "}
                <bdi className="ui-num ui-review-count" dir="ltr">{String(total)}</bdi>
              </>
            )}
          </span>
        </div>
      ) : null}
      {auto > 0 && !hideAuto ? (
        <Banner
          icon={<ReviewIcon />}
          title={filedTodayBannerTitle(auto)}
          hint={<TextLink to={filedTo ?? `/review/filed${search}`}>לרשימה</TextLink>}
          action={
            <IconButton label="סגירה" onClick={() => { setHideAuto(true); }}>
              <CloseIcon />
            </IconButton>
          }
        />
      ) : null}
      <div className="ui-review-motion" data-motion={motion === "still" ? undefined : motion} key={card.id}>
        <ReviewCard
          supplier={card.supplier_name ?? card.customer_name ?? card.description}
          sourceLine={`${card.direction === "income" ? "הכנסה" : docKindLabel(card.doc_kind)} · ${invoiceDate(card.doc_date)}`}
          netAgorot={card.amount_net}
          currency={card.currency}
          vatLine={reviewVatLine(card.vat_agorot, card.currency)}
          suggestion={shownSuggestion}
          pending={jevLoading}
          reason={card.reason}
          direction={card.direction}
          projectButtonRef={reviewLineFocus.project}
          categoryButtonRef={reviewLineFocus.category}
          onProject={holdWrites ? undefined : openProject}
          onCategory={holdWrites ? undefined : openCategory}
          meta={lineMeta.data}
          splitParts={mismatch ? splitParts : undefined}
          jevWhy={jevWhy}
          flag={flag}
          missingBoth={missingBoth}
        />
      </div>
      {holdWrites ? <ViewerNote className="t-hint ui-viewer-note" /> : (
      <ActionBar>
        {mismatch ? (
          <>
            <Button
              full
              disabled={approve.isPending || !card.transaction_id}
              onClick={() => {
                if (!card.transaction_id || approve.isPending) return;
                void navigate(`/transactions/${card.transaction_id}/split-category${search}`);
              }}
            >
              {SPLIT_MISMATCH_ACTION}
            </Button>
            <ActionBarRow>
              <div className="ui-review-approve" ref={approveSlot}>
                <Button
                  variant="secondary"
                  busy={approve.isPending}
                  disabled={!settled}
                  aria-describedby={REVIEW_MISMATCH_ID}
                  onClick={runApprove}
                >
                  {SPLIT_MISMATCH_KEEP}
                </Button>
              </div>
              {skipButton}
            </ActionBarRow>
          </>
        ) : (
          <>
            <div className="ui-review-approve" ref={approveSlot}>
              <Button
                full
                busy={approve.isPending}
                disabled={!settled}
                icon={approveLabel === "אישור" ? <CheckIcon /> : undefined}
                aria-describedby={missingBoth ? REVIEW_MISSING_ID : undefined}
                onClick={runApprove}
              >
                {approveLabel}
              </Button>
            </div>
            <ActionBarRow>
              <Button variant="secondary" to={change}>שינוי</Button>
              {skipButton}
            </ActionBarRow>
          </>
        )}
      </ActionBar>
      )}
    </div>
    </ViewerScope>
  );
}

function invoiceDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

function reviewVatLine(vat: bigint | undefined, currency?: string): string | null {
  if (currency != null && currency !== "ILS") return null;
  if (vat == null) return "לפני מע״מ";
  if (vat === 0n) return "פטור ממע״מ";
  const shown = vat < 0n ? -vat : vat;
  return `לפני מע״מ · מע״מ ${formatMoney(shown, currency)}`;
}

function docKindLabel(kind: string | undefined): string {
  if (kind === "invoice") return "חשבונית";
  if (kind === "receipt") return "קבלה";
  if (kind === "invoice_receipt") return "חשבונית מס קבלה";
  if (kind === "credit") return "זיכוי";
  if (kind === "expense") return "הוצאה";
  return "מסמך";
}

function vatStatusLabel(status: string): string {
  if (status === "source") return "לפי המסמך";
  if (status === "derived") return "חושב";
  if (status === "assumed") return "מע״מ משוער 18%";
  return "לא ידוע";
}

/** `jev` marks the fields whose shown value is Jev's fill, so the card says הצעת Jev there. */
function reviewSuggestion(row: ReviewRow, reversal = false, jev?: JevShown) {
  const split = reviewIsSplit(row);
  const project = split ? reviewSplitTitle(row) : row.project_name || undefined;
  const category = row.category_name || undefined;
  if (!project && !category) return undefined;
  const categorySuggested = Boolean(category) && row.category_suggested !== false;
  const projectSuggested = !split && row.project_suggested === true;
  return {
    ...(project ? { project } : {}),
    ...(category ? { category } : {}),
    ...(projectSuggested ? { projectSuggested: true } : {}),
    ...(categorySuggested ? { categorySuggested: true } : {}),
    ...(projectSuggested && jev?.project === true ? { projectJev: true } : {}),
    ...(categorySuggested && jev?.category === true ? { categoryJev: true } : {}),
    ...(reversal && category ? { categoryReversal: true } : {}),
  };
}

async function reopenReview(
  id: string,
  invalidate: (keys: string[]) => Promise<void>,
  toast: { show: (input: { message: string; tone?: "ok" | "bad"; action?: string; onAction?: () => void; place?: "bar" }) => void },
  done = "הפריט חזר לתור, והשיוך הקודם שוחזר.",
  /** ביטול's held line (review-pin.ts): a failed reopen drops the hold, ניסיון חוזר sets it again. */
  undo?: { line: string | null; failed: (line: string | null) => void },
) {
  try {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    assertNoError(await supabase.rpc("reopen_review", { p_id: id }));
    await invalidate(["review", "review-skipped", "dashboard", "project", "project-category", "project-waiting", "filed-today", "txn"]);
    toast.show({ message: done, place: "bar" });
  } catch {
    undo?.failed(undo.line);
    toast.show({
      place: "bar",
      tone: "bad",
      message: "לא הצלחנו לבטל.",
      action: "ניסיון חוזר",
      onAction: () => {
        if (undo != null) pinReviewLine(undo.line, { hold: true });
        void reopenReview(id, invalidate, toast, done, undo);
      },
    });
  }
}

export function ReviewEmpty({
  search,
  filtered = false,
  homeTo,
  homeLabel,
  backTo,
  skippedLink = false,
}: {
  search: string;
  filtered?: boolean;
  homeTo?: string;
  homeLabel?: string;
  backTo?: string;
  /** FLOW-309, owner pick 2026-10-08: "N פריטים דולגו" under the action when cards were skipped. */
  skippedLink?: boolean;
}) {
  const skipped = useSkippedReviewQuery(skippedLink && !filtered);
  const skippedCount = skippedLink && !filtered && !skipped.isError ? (skipped.data?.length ?? 0) : 0;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" backTo={backTo} layout="inline" />
      <EmptyState
        icon={<ReviewIcon />}
        title={filtered ? "אין פריטים לאישור בפרויקט הזה" : "הכל מאושר"}
        body={filtered ? "אין פריטים של הפרויקט הזה בתור." : "אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."}
        action={(
          <>
            <Button variant="pill" to={homeTo ?? `/${search}`}>{homeLabel ?? "לדף הבית"}</Button>
            <ReviewSkippedLink count={skippedCount} to={skippedListPath(reviewListPath(search))} />
          </>
        )}
      />
    </div>
  );
}

type CategorySample = {
  categoryName: string;
  projectName: string;
  /** The rows' currency. Default ILS. */
  currency?: string;
  rows: Array<{ id: string; description: string; doc_date: string; amount_net: bigint }>;
  /** Shows עוד תנועות until the rest of the sample rows are revealed. */
  pageSize?: number;
  /** FLOW-107. Loan split marks by row id, for stories. */
  loanMarks?: Record<string, LoanMark>;
};

/** The drill-down for one category row; a row in another currency names it (`?currency=`). */
function categoryHref(projectId: string, categoryId: string, currency: string, search: string): string {
  const path = `/projects/${projectId}/categories/${categoryId}`;
  if (currency === "ILS") return `${path}${search}`;
  return `${path}${search}${search === "" ? "?" : "&"}currency=${encodeURIComponent(currency)}`;
}

export function ProjectCategoryScreen({
  sample,
  backTo: backOverride,
  rowHref,
}: {
  sample?: CategorySample;
  backTo?: string;
  rowHref?: (row: { id: string }) => string;
} = {}) {
  const { projectId = "", categoryId = "" } = useParams();
  const [params] = useSearchParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const category = useProjectCategoryQuery(sample ? "" : projectId, sample ? "" : categoryId, params.get("currency") ?? "");
  const location = useLocation();
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, category);
  const [sampleOpen, setSampleOpen] = useState(false);
  const loadedRows = sample?.rows ?? (category.data?.pages.flatMap((page) => page?.rows ?? []) ?? []);
  const heldRows = useHeldOrder(loadedRows, (row) => row.id);
  const liveMarks = useLoanMarks(heldRows.map((row) => row.id), sample == null);
  const back = `/projects/${projectId}${search}`;
  if (phase.kind === "loading" || phase.kind === "error") {
    return <ScreenState title="קטגוריה" backTo={back} phase={phase} onRetry={() => { void category.refetch(); }} />;
  }
  const first = category.data?.pages[0];
  if (!sample && (first == null)) {
    return <ScreenHeader title="קטגוריה" subtitle="הפרויקט לא נמצא." backTo={`/projects${search}`} />;
  }
  const name = sample?.categoryName ?? first?.category_name ?? "קטגוריה";
  const projectName = sample?.projectName ?? first?.project_name ?? "";
  const rowCurrency = sample?.currency ?? first?.currency ?? "ILS";
  const allRows = heldRows;
  const rows = sample?.pageSize != null && !sampleOpen ? allRows.slice(0, sample.pageSize) : allRows;
  const rowIds = rows.map((row) => row.id);
  const more = sample?.pageSize != null ? !sampleOpen && allRows.length > sample.pageSize : !sample && category.hasNextPage;
  return (
    <div>
      <ScreenHeader title={name} subtitle={projectName} backTo={backOverride ?? back} />
      {rows.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין תנועות בקטגוריה הזו" body="הוצאות משויכות של הפרויקט יופיעו כאן." />
      ) : (
        <MonthList
          rows={rows}
          keyOf={(txn) => txn.id}
          dateOf={(txn) => txn.doc_date}
          amountOf={(txn) => ({ minor: txn.amount_net, currency: rowCurrency, direction: "expense" })}
          complete={!more}
          renderRow={(txn) => (
            <ListRow
              variant="transaction"
              title={txn.description}
              {...loanRowProps(sample ? sample.loanMarks?.[txn.id] : liveMarks.get(txn.id), formatDayMonth(txn.doc_date))}
              agorot={txn.amount_net}
              currency={rowCurrency}
              sign="out"
              source="invoice"
              href={rowHref ? rowHref(txn) : `/transactions/${txn.id}${search}`}
              state={rowHref ? undefined : txnListState(rowIds, txn.id, `${location.pathname}${location.search}`)}
            />
          )}
        />
      )}
      {more ? (
        <div className="ui-page-pad">
          <Button
            variant="pill"
            busy={!sample && category.isFetchingNextPage}
            onClick={() => {
              if (sample) {
                setSampleOpen(true);
                return;
              }
              void category.fetchNextPage();
            }}
          >
            עוד תנועות
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type ChangeSample = {
  supplier: string;
  amount: string;
  suggestionId?: string;
  suggestionCategoryId?: string;
  projectId?: string;
  categoryId?: string;
  projects: ChangeChoice[];
  categories: Array<{ id: string; name: string; hidden: boolean; kind?: string }>;
  direction?: "income" | "expense";
  initialQuery?: string;
  loading?: boolean;
  saveError?: boolean;
  /** A split in the queue. The sheet does not ask for a project. */
  split?: boolean;
  splitTitle?: string;
  /** False when the category is the owner's, so the sheet does not call it a suggestion. */
  categorySuggested?: boolean;
  /** False when the project is the owner's or a remembered rule, so it is not הצעה. */
  project_suggested?: boolean;
};

function withChoice(options: ChangeChoice[], id: string, name: string | null | undefined): ChangeChoice[] {
  if (id === "" || name == null || name === "" || options.some((option) => option.id === id)) return options;
  return [{ id, name }, ...options];
}

/**
 * FLOW-327 r1: the line names its party. An income line's party is its customer, so a new customer
 * reads "לקוח חדש · בלי היסטוריה".
 */
export function reviewHasParty(row: Pick<ReviewRow, "direction" | "supplier_name"> & { customer_name?: string | null }): boolean {
  const party = row.direction === "income" ? row.customer_name ?? row.supplier_name : row.supplier_name;
  return party != null && party !== "";
}

export function reviewIsSplit(row: { reason?: string | null; pnl_role?: string | null; share_count?: number | null } | null | undefined): boolean {
  if (!row) return false;
  return row.pnl_role === "shared" || (row.share_count ?? 0) > 1 || row.reason === "unallocated_shared";
}

export function reviewSplitTitle(row: { project_name?: string | null; share_count?: number | null; reason?: string | null }): string {
  if ((row.share_count ?? 0) > 1) return `מפוצל · ${String(row.share_count)} פרויקטים`;
  if (row.project_name) return row.project_name;
  return "עלות משותפת · טרם פוצלה";
}

export function ChangeForm({ sample: given }: { sample?: ChangeSample } = {}) {
  const [params] = useSearchParams();
  const sample: ChangeSample | undefined = given ?? (reviewE2e != null && params.get("e2e") === "list" ? reviewE2e.e2eChangeSample : undefined);
  const search = useFlowSearch();
  const preview = useHomePreview();
  const navigate = useNavigate();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const writeGate = useWriteGate("/review");
  const invalidate = useInvalidateBooks();
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const review = useReviewQuery(sample == null);
  const item = params.get("item") ?? "";
  const live = (review.data ?? []).find((entry) => entry.id === item);
  const [kept, setKept] = useState<ReviewRow | null>(null);
  useEffect(() => {
    if (live) setKept(live);
  }, [live]);
  const row = live ?? (kept?.id === item ? kept : null);
  const jev = useJevReview(
    sample || preview !== "off" ? null : (row?.transaction_id ?? null),
    sample == null && preview === "off",
  );
  const [projectId, setProjectId] = useState(sample?.projectId ?? sample?.suggestionId ?? "");
  const [categoryId, setCategoryId] = useState(sample?.categoryId ?? sample?.suggestionCategoryId ?? "");
  const [remember, setRemember] = useState(true);
  const [hold, setHold] = useState("");
  const [leaveNote, setLeaveNote] = useState("");
  const [savedRemember, setSavedRemember] = useState(true);
  const wroteReview = useRef(false);
  const closedReview = useRef(false);
  closedReview.current = wroteReview.current || (kept != null && live == null);
  const picked = useRef({ projectId, categoryId, remember });
  const sharedTx = useRef<string | null>(null);
  sharedTx.current = row?.transaction_id ?? null;
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const seeded = useRef(false);
  const baseline = useRef({ projectId: "", categoryId: "", remember: true });
  const toasted = useRef(false);
  const phase = sample
    ? ({ kind: "ready" } as const)
    : combinePhase(combinePhase(screenPhase(preview, dashboard), screenPhase(preview, categories)), screenPhase(preview, review));
  const direction = sample?.direction ?? row?.direction ?? "expense";
  const formPhase = phase.kind === "ready" && sample == null && row == null ? ({ kind: "empty" } as const) : phase;
  const income = direction === "income";
  const splitReview = sample?.split === true || reviewIsSplit(row);
  useEffect(() => {
    if (hold === "") return;
    const complete = splitReview ? categoryId !== "" : projectId !== "" && categoryId !== "";
    if (complete) setHold("");
  }, [hold, splitReview, projectId, categoryId]);
  useEffect(() => {
    if (leaveNote !== "" && remember === savedRemember) setLeaveNote("");
  }, [leaveNote, remember, savedRemember]);
  useEffect(() => {
    if (sample || !row || seeded.current) return;
    if (jev.loading) return;
    seeded.current = true;
    const filled = withJev(row, jev);
    const nextProject = filled.project_id ?? "";
    const nextCategory = filled.category_id ?? "";
    // FLOW-703: a category seeded from Jev's guess is not a supplier rule until the owner says so.
    const jevSeeded = filled.category_id !== row.category_id;
    baseline.current = { projectId: nextProject, categoryId: nextCategory, remember: !jevSeeded };
    setProjectId(nextProject);
    setCategoryId(nextCategory);
    if (jevSeeded) {
      setRemember(false);
      setSavedRemember(false);
    }
  }, [sample, row, jev]);
  useEffect(() => {
    if (!sample?.saveError || toasted.current) return;
    toasted.current = true;
    toast.show({
      tone: "bad",
      message: CHANGE_SAVE_FAILURE,
      action: "ניסיון חוזר",
      onAction: () => undefined,
    });
  }, [sample?.saveError, toast]);
  const filledRow = row ? withJev(row, jev) : row;
  const suggestionProjectId = sample
    ? (sample.project_suggested === false ? "" : (sample.suggestionId ?? ""))
    : (filledRow?.project_suggested === true ? (filledRow.project_id ?? "") : "");
  const suggestionCategoryId = sample?.suggestionCategoryId ?? sample?.categoryId ?? filledRow?.category_id ?? "";
  const projectOptions = withChoice(
    [...(sample?.projects ?? (dashboard.data?.projects ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
    }))), ...extraProjects],
    projectId,
    row?.project_name,
  );
  const reversalOptions = splitReview ? [] : reversalChoices(sample?.categories ?? categories.data ?? [], income ? "income" : "expense", sample?.categoryId ?? row?.category_id);
  const isReversalId = (id: string) => reversalOptions.some((option) => option.id === id);
  // The switch is hidden on a reversal, so it must not hold the sheet open.
  const rememberDirty = !income && !splitReview && !isReversalId(categoryId) && remember !== savedRemember;
  const categoryOptions = withChoice(
    (sample?.categories ?? categories.data ?? []).filter((category) => {
      if (category.hidden) return false;
      return income ? category.kind === "income" : category.kind !== "income";
    }).map((category) => ({ id: category.id, name: category.name })),
    isReversalId(categoryId) ? "" : categoryId,
    row?.category_name,
  );
  const save = useWrite({
    failure: changeSaveFailure,
    success: "השיוך נשמר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting"],
    onSplit: () => {
      if (!row?.transaction_id) return;
      void navigate(`/transactions/${row.transaction_id}/split${search}`, { replace: true });
    },
    onSuccess: () => {
      setSavedRemember(picked.current.remember);
      setProjectId(picked.current.projectId);
      setCategoryId(picked.current.categoryId);
      wroteReview.current = true;
    },
    run: async () => {
      const supabase = getSupabase();
      const next = picked.current;
      if (!supabase || item === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: item,
        p_action: "changed",
        p_project_id: next.projectId,
        p_category_id: next.categoryId,
        p_remember: next.remember,
      }));
    },
  });
  const lineField = useRef(false);
  const setSharedCategory = useWrite({
    failure: changeSaveFailure,
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setCategoryId(picked.current.categoryId);
      toast.show({
        message: "השיוך נשמר",
        ...(lineField.current ? { place: "page" as const } : {}),
      });
    },
    run: async () => {
      const supabase = getSupabase();
      const transactionId = sharedTx.current;
      const nextCategory = picked.current.categoryId;
      if (!supabase || transactionId == null || nextCategory === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("set_transaction_category", {
        p_id: transactionId,
        p_category_id: nextCategory,
        ...(lineField.current ? { p_resolve: false } : {}),
      }));
    },
  });
  const fieldSave = useRef<{ kind: "project" | "category"; id: string } | null>(null);
  const saveField = useWrite({
    failure: changeSaveFailure,
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      const pickedField = fieldSave.current;
      if (pickedField?.kind === "project") setProjectId(pickedField.id);
      else if (pickedField) setCategoryId(pickedField.id);
      toast.show({ message: "השיוך נשמר", place: "page" });
    },
    run: async () => {
      const supabase = getSupabase();
      const next = fieldSave.current;
      if (!supabase || item === "" || next == null) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: item,
        p_action: "changed",
        p_resolve: false,
        ...(next.kind === "project" ? { p_project_id: next.id } : { p_category_id: next.id }),
      }));
    },
  });
  const sharedUndoId = useRef<string | null>(null);
  const undoShared = useWrite({
    failure: "לא הצלחנו לבטל את השיוך.",
    success: "השיוך הקודם חזר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || sharedUndoId.current == null) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_reassign", { p_id: sharedUndoId.current }));
    },
  });
  const reassignClosed = useWrite({
    failure: changeSaveFailure,
    success: "השיוך נשמר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setProjectId(picked.current.projectId);
      setCategoryId(picked.current.categoryId);
      baseline.current = { ...baseline.current, projectId: picked.current.projectId, categoryId: picked.current.categoryId };
    },
    run: async () => {
      const supabase = getSupabase();
      const next = picked.current;
      const transactionId = sharedTx.current;
      if (!supabase || transactionId == null || next.categoryId === "") throw new Error("supabase");
      if (next.projectId === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("reassign_transaction", {
        p_id: transactionId,
        p_project_id: next.projectId,
        p_category_id: next.categoryId,
      }));
    },
  });
  const collapseShared = useWrite({
    failure: changeSaveFailure,
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setProjectId(picked.current.projectId);
      const id = sharedUndoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(id ? { action: "ביטול", onAction: () => { undoShared.mutate(); } } : {}),
      });
    },
    run: async () => {
      sharedUndoId.current = await collapseSplit(sharedTx.current ?? "", picked.current.projectId);
    },
  });

  async function createProject(name: string): Promise<ChangeChoice> {
    if (holdWrites) throw new Error("preview");
    return saveNewProject(name, blocked, toast, (project) => {
      setExtraProjects((list) => [...list, project]);
    }, invalidate);
  }

  const fromList = (params.get("from") === "all" || params.get("list") === "all") && item !== "";
  const closeTo = fromList ? reviewFocusPath(search, item) : `/review${search}`;
  const linePick = params.get("from") === "line" ? params.get("pick") : null;
  const returnFocusRef = linePick === "project"
    ? reviewLineFocus.project
    : linePick === "category"
      ? reviewLineFocus.category
      : undefined;
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  if (formPhase.kind !== "ready") {
    return (
      <RouteSheet title="שינוי שיוך" closeTo={closeTo} returnFocusRef={returnFocusRef}>
        <ScreenState title="שינוי שיוך" phase={formPhase} onRetry={() => { void dashboard.refetch(); void categories.refetch(); void review.refetch(); }} />
      </RouteSheet>
    );
  }

  return (
    <ChangeAssignment
      host="route"
      closeTo={closeTo}
      returnFocusRef={returnFocusRef}
      supplier={sample?.supplier ?? row?.supplier_name ?? row?.description ?? ""}
      amount={sample?.amount ?? (row ? formatAmountText(absAgorot(row.amount_net), row.currency, {
        direction: income ? "income" : "expense",
        detail: true,
      }) : "")}
      direction={income ? "income" : "expense"}
      projects={projectOptions}
      categories={categoryOptions}
      reversals={reversalOptions}
      projectId={projectId}
      categoryId={categoryId}
      suggestionProjectId={suggestionProjectId}
      suggestionCategoryId={suggestionCategoryId}
      onProjectId={setProjectId}
      onCategoryId={setCategoryId}
      {...(income || splitReview ? {} : { remember, onRemember: setRemember })}
      categorySuggested={sample ? sample.categorySuggested !== false : filledRow?.category_suggested !== false}
      hold={hold || leaveNote}
      pending={rememberDirty && !wroteReview.current && !closedReview.current}
      projectNote={splitReview ? COLLAPSE_SPLIT_NOTE : undefined}
      projectTitle={sample?.splitTitle ?? (splitReview && row ? reviewSplitTitle(row) : undefined)}
      initialQuery={sample?.initialQuery}
      loading={sample?.loading}
      onDiscard={() => {
        setProjectId(baseline.current.projectId);
        setCategoryId(baseline.current.categoryId);
        setRemember(baseline.current.remember);
        setSavedRemember(baseline.current.remember);
        setHold("");
        setLeaveNote("");
      }}
      onCommitPick={async (kind, id) => {
        if (sample || holdWrites) return undefined;
        if (blocked()) throw new Error("preview");
        const nextProject = kind === "project" ? id : projectId;
        const nextCategory = kind === "category" ? id : categoryId;
        // A supplier rule never learns a reversal: the next line from this supplier is the usual kind.
        picked.current = { projectId: nextProject, categoryId: nextCategory, remember: remember && !isReversalId(nextCategory) };
        const fromLine = params.get("from") === "line";
        if (splitReview) {
          if (kind === "project") {
            if (!row?.transaction_id || id === "") throw new Error("supabase");
            await collapseShared.mutateAsync();
            return undefined;
          }
          if (!row?.transaction_id) throw new Error("supabase");
          lineField.current = fromLine;
          await setSharedCategory.mutateAsync();
          return undefined;
        }
        if (fromLine) {
          fieldSave.current = { kind, id };
          await saveField.mutateAsync();
          return undefined;
        }
        const complete = nextProject !== "" && nextCategory !== "";
        if (!complete) {
          setHold("בחרו פרויקט וקטגוריה.");
          return "hold";
        }
        setHold("");
        if (closedReview.current) {
          await reassignClosed.mutateAsync();
          return undefined;
        }
        await save.mutateAsync();
        return undefined;
      }}
      onCloseCheck={() => {
        if (sample) return Promise.resolve();
        if (blocked()) return Promise.reject(new Error("preview"));
        const complete = splitReview ? categoryId !== "" : projectId !== "" && categoryId !== "";
        if (!complete) {
          setHold(splitReview ? "בחרו קטגוריה." : "בחרו פרויקט וקטגוריה.");
          return Promise.reject(new Error("incomplete"));
        }
        if (rememberDirty && (wroteReview.current || closedReview.current)) {
          setLeaveNote("הזכירה נשמרת עם השיוך. החזירו את המתג כדי לסגור.");
          return Promise.reject(new Error("remember"));
        }
        return Promise.resolve();
      }}
      onCommitPending={async () => {
        if (sample || holdWrites) return;
        if (blocked()) throw new Error("preview");
        setHold("");
        picked.current = { projectId, categoryId, remember: remember && !isReversalId(categoryId) };
        await save.mutateAsync();
      }}
      onSplit={() => {
        if (row?.transaction_id) {
          void navigate(`/transactions/${row.transaction_id}/split${search}`, { replace: true });
          return;
        }
        toast.show({ message: "הפיצול נעשה ממסך התנועה, אחרי השיוך." });
      }}
      onCreateProject={createProject}
    />
  );
}

export function AddForm() {
  const search = usePreviewSearch();
  const goBack = useGoBack();
  const writeGate = useWriteGate("/");
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  return (
    <RouteSheet
      title="הוספה"
      closeTo={`/${search}`}
      returnFocusRef={addTriggerRef}
    >
      <p className="t-hint">הצילום וההזנה הידנית יגיעו בהמשך.</p>
      <div className="ui-add-rows">
        <ListRow
          variant="button"
          disabled
          title="צילום חשבונית"
          hint="מצלמה או PDF · קורא ספק, סכום, מע״מ ותאריך"
          wrapHint
          icon={<CameraIcon size={26} />}
        />
        <ListRow
          variant="button"
          disabled
          title="הזנה ידנית"
          hint="סכום, פרויקט וקטגוריה – רק במקרה הצורך"
          icon={<PencilIcon size={26} />}
        />
      </div>
      <Button variant="ghost" full onClick={() => { goBack(`/${search}`); }}>ביטול</Button>
    </RouteSheet>
  );
}

function daysBefore(iso: string): number {
  const today = israelToday();
  const start = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const end = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

function unpaidHintLine(row: UnpaidRow): string {
  const date = formatDayMonth(row.doc_date);
  const project = row.project_name ?? "";
  const age = `לפני ${String(daysBefore(row.doc_date))} ימים`;
  return [date, project, age].filter((part) => part !== "").join(" · ");
}

export function UnpaidScreen({ sample }: { sample?: UnpaidRow[] } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const unpaid = useUnpaidQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, unpaid);
  const [hidden, setHidden] = useState<string[]>([]);
  const [marking, setMarking] = useState<UnpaidRow | null>(null);
  const all = sample ?? unpaid.data ?? [];
  const rows = useHeldOrder(all.filter((row) => !hidden.includes(row.id)), (row) => row.id);
  const gross = all.reduce((sum, row) => sum + absAgorot(row.open_gross_agorot), 0n);
  return (
    <ScreenState
      title="חשבוניות שלא שולמו"
      backTo={`/${search}`}
      phase={phase.kind === "ready" && all.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void unpaid.refetch(); }}
      empty={<EmptyState icon={<ReviewIcon />} title="הכל שולם" body="אין חשבוניות פתוחות כרגע." />}
    >
      <div className="ui-page-pad">
        <p className="t-display"><bdi dir="ltr">{formatIls(gross)}</bdi></p>
        <p className="t-label text-text-secondary">ממתין לתשלום · טרם נגבה</p>
      </div>
      <List>
        {rows.map((row) => (
          <ListRow
            key={row.id}
            variant="project"
            title={row.customer_name ?? row.description}
            hint={unpaidHintLine(row)}
            wrapHint
            agorot={absAgorot(row.open_gross_agorot)}
            loss={false}
            actionBelow
            action={
              <Button
                variant="pill"
                icon={<CheckIcon />}
                onClick={() => {
                  setMarking(row);
                }}
              >
                סימון כשולם
              </Button>
            }
          />
        ))}
      </List>
      <Sheet
        open={marking != null}
        onOpenChange={(open) => {
          if (!open) setMarking(null);
        }}
        title="סימון כשולם"
      >
        <p className="t-label">השורה תצא מהרשימה כש־SUMIT יראה את החשבונית כשולמה בסנכרון הבא. Flow לא מסמן תשלום ב־SUMIT.</p>
        <Button
          onClick={() => {
            if (marking) setHidden((current) => [...current, marking.id]);
            setMarking(null);
          }}
        >
          הבנתי
        </Button>
      </Sheet>
    </ScreenState>
  );
}

function splitProjectLabel(
  txn: { allocations?: Array<{ project_name?: string | null }> },
  splitRow: boolean,
  fallback: string,
): string {
  if (!splitRow) return fallback;
  const rows = txn.allocations ?? [];
  if (rows.length === 0) return "עלות משותפת · טרם פוצלה";
  if (rows.length === 1) return rows[0]?.project_name || "פרויקט";
  return `מפוצל · ${String(rows.length)} פרויקטים`;
}

/** What a screen reader hears after prev or next: the kind, the party and the amount, with no bare minus. */
function txnAnnouncement(txn: NonNullable<TransactionDetail>): string {
  const party = txn.supplier_name ?? txn.customer_name ?? txn.description;
  const kind = txn.direction === "income" ? "הכנסה" : "הוצאה";
  const amount = formatAmountText(absAgorot(txn.amount_net), txn.currency ?? "ILS", { detail: true });
  return `${kind}, ${party}, ${amount}`;
}

type LinePnlChange = {
  id: string;
  party: string;
  /** The override to write: false out, true in, null follows the category. */
  override: boolean | null;
  previous: boolean | null;
  /** The line is out of the P&L after this write. */
  out: boolean;
  undo: boolean;
};

type LinePnl = { override: boolean | null; categoryOut: boolean; out: boolean; forcedIn: boolean; next: boolean | null };

/**
 * FLOW-108, decision 0112. Going back to the category's own state always clears the override.
 * FLOW-121, decision 0114: a guessed kept-out category counts until it is confirmed.
 */
export function linePnlState(
  txn: { category_excluded_from_pnl?: boolean; category_suggested?: boolean; pnl_fixed?: boolean; in_pnl?: boolean },
  override: boolean | null,
): LinePnl {
  // A loan line ignores the override, so the server's in_pnl is the category's say. Only a loan
  // category stays out as a guess; a loan-split line under a guessed other category counts.
  const categoryOut = txn.pnl_fixed === true && txn.in_pnl != null
    ? !txn.in_pnl
    : txn.category_excluded_from_pnl === true && txn.category_suggested !== true;
  const out = override === false || (override == null && categoryOut);
  const forcedIn = override === true && categoryOut;
  const next = out ? (categoryOut ? true : null) : (categoryOut ? null : false);
  return { override, categoryOut, out, forcedIn, next };
}

function linePnlHint(pnl: LinePnl, categoryName: string): string {
  if (pnl.out && pnl.override === false) return "רק השורה הזו. הקטגוריה לא משתנה.";
  if (pnl.out) return `הקטגוריה ${categoryName} מחוץ לרווח והפסד. אפשר להחזיר רק את השורה הזו.`;
  if (pnl.forcedIn) return `כמו שאר הקטגוריה ${categoryName}.`;
  return "הכסף נשאר בתזרים, ולא נספר כהכנסה או הוצאה.";
}

export function TransactionScreen({
  sample,
  sampleProjects,
  sampleCategories,
  sampleLineSplit,
  onOpenSplit,
}: {
  sample?: NonNullable<TransactionDetail>;
  sampleProjects?: Array<{ id: string; name: string; code?: string }>;
  sampleCategories?: Array<{ id: string; name: string; kind?: "income" | "expense" }>;
  /** FLOW-325: a story's split by category, in place of the get_line_split read. */
  sampleLineSplit?: LineSplitRead | null;
  /** Reviewer preview stays on its own split instead of the ledger route. */
  onOpenSplit?: () => void;
} = {}) {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const invalidate = useInvalidateBooks();
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  // FLOW-320: each row opens its own picker, and the sheet returns focus to that row.
  const [changeStart, setChangeStart] = useState<"project" | "category">("project");
  const projectRowRef = useRef<HTMLButtonElement>(null);
  const categoryRowRef = useRef<HTMLButtonElement>(null);
  const leaveChange = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const setChangeSheet = useSheetHistory("txn-change", changeOpen, setChangeOpen, () => leaveChange.current());
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const detail = useTransactionQuery(sample ? "" : transactionId);
  const lineMeta = useLineMetaQuery(sample ? sample.id : transactionId, sample == null);
  const nav = useTxnNav(sample?.id ?? transactionId);
  const goBack = useGoBack();
  useTxnNavKeys(nav);
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const lineSplitQuery = useLineSplitQuery(sample ? "" : transactionId, sample == null);
  const loanSplitFlag = useLoanSplitFlag(sample?.id ?? transactionId);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const remove = useWrite({
    failure: "לא הצלחנו למחוק.",
    // A card opened from a list returns to it, so that list drops the row too.
    keys: ["dashboard", "txn", "unpaid", "review", "project", "project-category", "filed-today"],
    onSuccess: () => {
      setConfirm(false);
      // Opened from a list: back to that list, not Home.
      if (nav) goBack(nav.list.from);
      else void navigate(`/${search}`);
    },
    run: async () => {
      const supabase = getSupabase();
      const current = sample ?? detail.data;
      if (!supabase || !current) throw new Error("supabase");
      assertNoError(await supabase.rpc("delete_transaction", { p_id: current.id }));
    },
  });
  const txn = sample ?? detail.data;
  const parent = transactionParent(txn?.project_id, search);
  usePrefetchNeighbours(nav, txn != null);
  useAnnounceTxn(nav, txn == null ? null : txnAnnouncement(txn));
  // FLOW-108. A sample card keeps its override locally; a live card reads it back from the server.
  const [sampleOverride, setSampleOverride] = useState<boolean | null | undefined>(undefined);
  const pnlHintId = useId();
  const pnlLine = useWrite<LinePnlChange>({
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את השורה."),
    keys: ["txn", "dashboard", "project", "project-category", "home", "breakdown", "breakdown-lines"],
    onSuccess: (done) => {
      setMenu(false);
      toast.show({
        message: `${done.party} · ${done.out ? KEPT_OUT : "ברווח והפסד"}`,
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => {
            pnlLine.mutate({ ...done, override: done.previous, previous: done.override, out: !done.out, undo: true });
          },
        }),
      });
    },
    run: async (change) => {
      if (sample) {
        setSampleOverride(change.override);
        return;
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // null clears the override; the generated types mark every argument non-null.
      assertNoError(await supabase.rpc("set_transaction_pnl", { p_id: change.id, p_in_pnl: change.override as boolean }));
    },
  });
  const [projectName, setProjectName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [hold, setHold] = useState("");
  const writeTarget = useRef({ projectId: "", categoryId: "" });
  const committed = useRef({ projectId: "", categoryId: "" });
  const namesRef = useRef({
    projects: [] as Array<{ id: string; name: string }>,
    categories: [] as Array<{ id: string; name: string }>,
  });
  namesRef.current = {
    projects: sample
      ? [...(sampleProjects ?? []), ...extraProjects]
      : [...(dashboard.data?.projects ?? []), ...extraProjects],
    categories: sample ? (sampleCategories ?? []) : (categories.data ?? []),
  };
  const applyRef = useRef<() => void>(() => undefined);
  applyRef.current = () => {
    const next = writeTarget.current;
    committed.current = next;
    setProjectId(next.projectId);
    setCategoryId(next.categoryId);
    const namedProject = namesRef.current.projects.find((project) => project.id === next.projectId);
    if (namedProject) setProjectName(namedProject.name);
    const namedCategory = namesRef.current.categories.find((category) => category.id === next.categoryId);
    if (namedCategory) setCategoryName(namedCategory.name);
  };
  useEffect(() => {
    if (changeOpen || !txn) return;
    setProjectId(committed.current.projectId !== "" ? committed.current.projectId : (txn.project_id ?? ""));
    setCategoryId(committed.current.categoryId !== "" ? committed.current.categoryId : (txn.category_id ?? ""));
  }, [changeOpen, txn]);
  useEffect(() => {
    if (hold === "" || !txn) return;
    const splitLike = txn.pnl_role === "shared" || txn.review_reason === "unallocated_shared" || (txn.allocations?.length ?? 0) > 1;
    const complete = splitLike ? categoryId !== "" : projectId !== "" && categoryId !== "";
    if (complete) setHold("");
  }, [hold, txn, categoryId, projectId]);
  const undoId = useRef<string | null>(null);
  const undo = useWrite({
    failure: "לא הצלחנו לבטל את השיוך.",
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
    success: "השיוך הקודם חזר",
    onSuccess: () => {
      committed.current = { projectId: "", categoryId: "" };
      setProjectName("");
      setCategoryName("");
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || undoId.current == null) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_reassign", { p_id: undoId.current }));
    },
  });
  const reassign = useWrite({
    failure: changeSaveFailure,
    onSplit: () => {
      if (onOpenSplit) {
        onOpenSplit();
        return;
      }
      void navigate(`/transactions/${transactionId}/split${search}`, { replace: true });
    },
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
    onSuccess: () => {
      applyRef.current();
      const id = undoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(!sample && id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
      });
    },
    run: async () => {
      const current = sample ?? detail.data;
      const next = writeTarget.current;
      if (!current) throw new Error("supabase");
      const supabase = getSupabase();
      if (!supabase || next.projectId === "" || next.categoryId === "") throw new Error("supabase");
      const saved = await supabase.rpc("reassign_transaction", {
        p_id: current.id,
        p_project_id: next.projectId,
        p_category_id: next.categoryId,
      });
      assertNoError(saved);
      undoId.current = typeof saved.data === "string" ? saved.data : null;
    },
  });
  const setCategory = useWrite({
    failure: changeSaveFailure,
    onSplit: () => {
      void navigate(`/transactions/${transactionId}/split${search}`, { replace: true });
    },
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
    onSuccess: () => {
      applyRef.current();
      const id = undoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(!sample && id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
      });
    },
    run: async () => {
      const current = sample ?? detail.data;
      const nextCategory = writeTarget.current.categoryId;
      if (!current) throw new Error("supabase");
      const supabase = getSupabase();
      if (!supabase || nextCategory === "") throw new Error("supabase");
      const saved = await supabase.rpc("set_transaction_category", {
        p_id: current.id,
        p_category_id: nextCategory,
      });
      assertNoError(saved);
      undoId.current = typeof saved.data === "string" ? saved.data : null;
    },
  });
  // While a card loads or fails, ⋯ keeps its slot so ˄ ˅ stay under the finger,
  // and the long title sits under the bar so it fits at 320.
  const navEnd = nav ? (
    <div className="ui-txn-end">
      <TxnNavButtons nav={nav} />
      <ReservedMenuSlot />
    </div>
  ) : undefined;
  if (phase.kind === "loading" || phase.kind === "error" || phase.kind === "empty") {
    return <ScreenState title="פרטי תנועה" backTo={parent} stacked={nav != null} action={navEnd} phase={phase.kind === "empty" ? { kind: "empty" } : phase} onRetry={() => { void detail.refetch(); }} empty={<p className="ui-page-pad t-hint">אין תנועה להצגה.</p>} />;
  }
  if (!txn) {
    return nav
      ? <ScreenHeader layout="stacked" title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={parent} trailing={navEnd} />
      : <ScreenHeader title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={parent} />;
  }
  const detailRow = txn;
  const serverSplit = detailRow.pnl_role === "shared" || detailRow.review_reason === "unallocated_shared" || (detailRow.allocations?.length ?? 0) > 1;
  const splitRow = serverSplit;
  const shownProject = splitProjectLabel(txn, splitRow, projectName || txn.project_name || "בלי פרויקט");
  const shownCategory = categoryName || txn.category_name || "בלי קטגוריה";
  const shownCategoryId = categoryId || txn.category_id || "";
  const shownLoanPart = categories.data?.find((category) => category.id === shownCategoryId)?.loan_part ?? null;
  function openSplit() {
    if (onOpenSplit) {
      onOpenSplit();
      return;
    }
    void navigate(`/transactions/${detailRow.id}/split${search}`);
  }
  async function commitPick(kind: "project" | "category", id: string) {
    const previous = { projectId, categoryId };
    // A split's project row opens the split screen, so a split only picks a category here.
    const categoryOnly = splitRow && kind === "category";
    const next = {
      projectId: kind === "project" ? id : previous.projectId,
      categoryId: kind === "category" ? id : previous.categoryId,
    };
    writeTarget.current = next;
    const complete = categoryOnly ? next.categoryId !== "" : next.projectId !== "" && next.categoryId !== "";
    if (!complete) {
      // Name only what is still missing.
      setHold(categoryOnly || next.projectId !== "" ? "בחרו קטגוריה." : next.categoryId === "" ? "בחרו פרויקט וקטגוריה." : "בחרו פרויקט.");
      return "hold" as const;
    }
    setHold("");
    try {
      if (sample) {
        applyRef.current();
        toast.show({ message: "השיוך נשמר" });
        return undefined;
      }
      if (blocked()) throw new Error("preview");
      if (categoryOnly) await setCategory.mutateAsync();
      else await reassign.mutateAsync();
    } catch (error) {
      setProjectId(previous.projectId);
      setCategoryId(previous.categoryId);
      throw error;
    }
    return undefined;
  }
  const party = txn.supplier_name ?? txn.customer_name ?? txn.description;
  const changeProjects = withChoice(
    [
      ...(sample
        ? (sampleProjects ?? []).map((project) => ({ id: project.id, name: project.name, code: project.code }))
        : (dashboard.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name, status: project.status }))),
      ...extraProjects,
    ],
    projectId,
    txn.project_name,
  );
  const txnDirection = txn.direction === "income" ? "income" : "expense";
  const changeReversals = sample || splitRow ? [] : reversalChoices(categories.data ?? [], txnDirection, txn.category_id);
  const changeCategories = withChoice(
    (sample
      ? (sampleCategories ?? [])
      : (categories.data ?? []).filter((category) => !category.hidden && (txn.direction === "income" ? category.kind === "income" : category.kind !== "income"))
    ).map((category) => ({ id: category.id, name: category.name })),
    changeReversals.some((option) => option.id === categoryId) ? "" : categoryId,
    txn.category_name,
  );
  const shownReversal = sample == null && isReversal(categories.data ?? [], categoryId || txn.category_id, txnDirection);
  const reviewLabel = txn.review_status === "open" ? "ממתין לאישור" : txn.review_status === "approved" || txn.review_status === "changed" ? "מאושר" : null;
  const paymentLabel = txn.open_gross_agorot != null && txn.open_gross_agorot !== 0n ? "טרם נגבה" : txn.paid === true ? "שולם" : null;
  const vatShown = (txn.currency ?? "ILS") === "ILS";
  const pnl = linePnlState(txn, sample != null && sampleOverride !== undefined ? sampleOverride : (txn.in_pnl_override ?? null));
  const pnlPill = pnl.out ? (
    <StatusPill icon={<KeptOutIcon size={16} />}>{KEPT_OUT_SHORT}</StatusPill>
  ) : pnl.forcedIn ? <StatusPill>ברווח והפסד</StatusPill> : null;
  const pnlSplit = txn.pnl_role === "shared" || (txn.allocations?.length ?? 0) > 1;
  const lineSplit = sample ? (sampleLineSplit ?? null) : lineSplitQuery.data;
  // FLOW-325 (plan Q9): the P&L reads the parts, not the line's own category and project.
  const lineSplitHint = lineSplitRowHint(lineSplit);
  const menuButton = holdWrites ? <ReservedMenuSlot /> : <IconButton ref={moreRef} label="עוד" onClick={() => { setMenu(true); }}><MoreIcon /></IconButton>;
  return (
    <div>
      <ScreenHeader
        title={txn.direction === "income" ? "הכנסה" : "הוצאה"}
        size="compact"
        leading={<BackButton fallback={parent} />}
        trailing={nav ? (
          <div className="ui-txn-end">
            <TxnNavButtons nav={nav} />
            {menuButton}
          </div>
        ) : menuButton}
      />
      <div className="ui-page-pad">
        <p className="t-title-3 ui-party">{party}</p>
        <p className="t-display">
          <BigNumber
            agorot={absAgorot(txn.amount_net)}
            presentation="detail"
            currency={txn.currency}
            direction={txn.direction === "income" ? "income" : "expense"}
            income={txn.direction === "income"}
            size="display"
          />
        </p>
        <p className="t-hint">
          {vatShown ? "לפני מע״מ · " : null}
          <bdi dir="ltr">{invoiceDate(txn.doc_date)}</bdi>
        </p>
        {reviewLabel || paymentLabel || pnlPill ? (
          <div className="ui-status-row">
            {reviewLabel ? <StatusPill>{reviewLabel}</StatusPill> : null}
            {paymentLabel ? <StatusPill icon={paymentLabel === "שולם" ? <CheckIcon size={14} /> : undefined}>{paymentLabel}</StatusPill> : null}
            {pnlPill}
          </div>
        ) : null}
      </div>
      <List>
        {holdWrites ? (
          <ListRow variant="static" eyebrow="פרויקט" title={shownProject} icon={<ProjectsIcon />} hint={lineSplitHint} />
        ) : (
          <ListRow variant="button" buttonRef={projectRowRef} eyebrow="פרויקט" title={shownProject} icon={<ProjectsIcon />} hint={lineSplitHint} chevron onClick={() => {
            if (splitRow) {
              openSplit();
              return;
            }
            setChangeStart("project");
            setChangeSheet(true);
          }} />
        )}
        {holdWrites ? (
          <ListRow variant="static" eyebrow="קטגוריה" title={shownCategory} icon={<TagIcon />} tag={shownReversal ? <ReversalTag /> : undefined} hint={lineSplitHint} />
        ) : (
          <ListRow variant="button" buttonRef={categoryRowRef} eyebrow="קטגוריה" title={shownCategory} icon={<TagIcon />} tag={shownReversal ? <ReversalTag /> : undefined} hint={lineSplitHint} chevron onClick={() => {
            setChangeStart("category");
            setChangeSheet(true);
          }} />
        )}
      </List>
      <LoanTransactionSplit
        transactionId={txn.id}
        docDate={txn.doc_date}
        loanPart={shownLoanPart}
        direction={txn.direction}
        active={sample == null}
        readOnly={holdWrites}
      />
      {vatShown && txn.vat_amount !== 0n ? (
        <p className="ui-page-pad t-hint">
          מע״מ <bdi dir="ltr">{formatMoney(txn.vat_amount, txn.currency, { agorot: true })}</bdi>
          {" · "}
          {vatStatusLabel(txn.vat_status)}
        </p>
      ) : null}
      {lineMeta.isError && lineMeta.data == null ? (
        <LoanReadError label="פרטי הבנק" busy={lineMeta.isFetching} onRetry={() => { void lineMeta.refetch(); }} />
      ) : (
        <BankDetails meta={lineMeta.data} party={party} direction={txnDirection} />
      )}
      <LineSplitSection
        txn={txn}
        split={lineSplit}
        readOnly={holdWrites}
        categories={sample ? (sampleCategories ?? []) : (categories.data ?? [])}
        loanSplit={loanSplitFlag}
        projectSplitTo={`/transactions/${txn.id}/split${search}`}
        onProjectSplit={onOpenSplit ? openSplit : undefined}
        categorySplitTo={onOpenSplit ? undefined : `/transactions/${txn.id}/split-category${search}`}
      />
      <ChangeAssignment
        host="overlay"
        open={changeOpen}
        onOpenChange={setChangeSheet}
        contained
        start={changeStart}
        returnFocusRef={changeStart === "category" ? categoryRowRef : projectRowRef}
        supplier={party}
        amount={formatAmountText(absAgorot(txn.amount_net), txn.currency, {
          direction: txn.direction === "income" ? "income" : "expense",
          detail: true,
        })}
        direction={txn.direction === "income" ? "income" : "expense"}
        projects={changeProjects}
        categories={changeCategories}
        reversals={changeReversals}
        projectId={projectId}
        categoryId={categoryId}
        onProjectId={setProjectId}
        onCategoryId={setCategoryId}
        hold={hold}
        leave={leaveChange}
        onDiscard={() => {
          setHold("");
          setProjectId(committed.current.projectId !== "" ? committed.current.projectId : (detailRow.project_id ?? ""));
          setCategoryId(committed.current.categoryId !== "" ? committed.current.categoryId : (detailRow.category_id ?? ""));
        }}
        loading={sample == null && (dashboard.isLoading || categories.isLoading)}
        onCommitPick={commitPick}
        onSplit={() => {
          setChangeOpen(false);
          openSplit();
        }}
        onCreateProject={(name) => saveNewProject(name, blocked, toast, (project) => {
          setExtraProjects((list) => [...list, project]);
        }, invalidate)}
      />
      <Sheet
        open={menu}
        onOpenChange={(open) => {
          // 0075: a dismiss during the P&L write waits for it; success closes the sheet, failure keeps it.
          if (open) return true;
          if (pnlLine.isPending) return false;
          setMenu(false);
          return true;
        }}
        title="עוד"
        returnFocusRef={moreRef}
      >
        <div className="ui-stack">
          {txn.pnl_fixed === true ? (
            <p className="ui-cat-fixed">
              <LockIcon size={18} />
              תשלום הלוואה · נספר לפי הפיצול
            </p>
          ) : (
            <>
              <Button
                variant="secondary"
                icon={<KeptOutIcon />}
                busy={pnlLine.isPending}
                aria-describedby={pnlHintId}
                onClick={() => {
                  if (pnlLine.isPending || (sample == null && blocked())) return;
                  pnlLine.mutate({
                    id: txn.id,
                    party,
                    override: pnl.next,
                    previous: pnl.override,
                    out: !pnl.out,
                    undo: false,
                  });
                }}
              >
                {pnlLine.isPending ? "מעדכן…" : pnl.out ? "החזרה לרווח והפסד" : KEPT_OUT}
              </Button>
              <p id={pnlHintId} className="t-hint ui-cat-pnl-hint">
                {linePnlHint(pnl, txn.category_name ?? "")}
                {pnlSplit ? " כל הפרויקטים בשורה." : null}
              </p>
            </>
          )}
          {txn.source === "manual" ? (
            <Button variant="danger" icon={<TrashIcon />} disabled={pnlLine.isPending} onClick={() => { setMenu(false); setConfirm(true); }}>מחיקה</Button>
          ) : (
            <p className="t-hint">תנועה מ־SUMIT לא נמחקת כאן. היא מתעדכנת בסנכרון.</p>
          )}
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title="למחוק את הרשומה?"
        item={txn.description}
        consequence="למחוק את הרשומה הידנית? אי אפשר לשחזר."
        confirmLabel="מחיקה"
        destructive
        busy={remove.isPending}
        onConfirm={() => {
          if (blocked()) return;
          remove.mutate();
        }}
      />
    </div>
  );
}

function evenSentence(parts: AllocatedPart[], total: bigint): string {
  const first = parts[0];
  if (!first) return "";
  if (parts.length === 1) return `${formatShare(first.agorot)} לפרויקט אחד`;
  const same = parts.every((part) => part.agorot === first.agorot);
  if (same) return `${formatShare(first.agorot)} לכל אחד מ־${String(parts.length)} פרויקטים`;
  return `${formatShare(total)} מתחלק שווה בין ${String(parts.length)} פרויקטים`;
}

function percentWords(bp: number): string {
  const tenths = Math.round(Math.abs(bp) / 10);
  const whole = Math.trunc(tenths / 10);
  const frac = tenths % 10;
  return frac === 0 ? String(whole) : `${String(whole)}.${String(frac)}`;
}

function sameBasis(left: Record<string, number>, right: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) return false;
  }
  return true;
}

type SplitDraft = {
  method: SplitMethod | null;
  manual: Record<string, string>;
  chosen: string[];
  oneProject: string;
};

type SplitPop = (event: PopStateEvent) => void;
let splitPop: SplitPop | null = null;
if (typeof window !== "undefined" && !(window as Window & { __flowSplitPop?: boolean }).__flowSplitPop) {
  (window as Window & { __flowSplitPop?: boolean }).__flowSplitPop = true;
  window.addEventListener("popstate", (event) => {
    splitPop?.(event);
  }, true);
}

function readSplitDraft(id: string): SplitDraft | null {
  if (id === "" || typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(splitDraftKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      method?: unknown;
      manual?: SplitDraft["manual"];
      chosen?: SplitDraft["chosen"];
      oneProject?: string;
    };
    const method = parsed.method;
    if (method != null && method !== "equal" && method !== "chosen" && method !== "income" && method !== "manual" && method !== "one") return null;
    const known = method === "equal" || method === "chosen" || method === "income" || method === "manual" || method === "one" ? method : null;
    return {
      method: known,
      manual: parsed.manual ?? {},
      chosen: parsed.chosen ?? [],
      oneProject: parsed.oneProject ?? "",
    };
  } catch {
    return null;
  }
}

function writeSplitDraft(id: string, draft: SplitDraft) {
  if (id === "" || typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(splitDraftKey(id), JSON.stringify(draft));
}

function clearSplitDraft(id: string) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(splitDraftKey(id));
}

export function SplitScreen({
  sampleProjects,
  sampleAmount,
  sampleMeta,
  sampleMethod,
  sampleShares,
  sampleChosen,
  sampleSaving = false,
  onSave,
  onOneProject,
  example,
  backTo,
}: {
  sampleProjects?: SplitProject[];
  sampleAmount?: bigint;
  /** Supplier · date under the amount. Stories pass the spec line. */
  sampleMeta?: string;
  sampleMethod?: SplitMethod | null;
  /** Manual percents, as typed. One decimal. */
  sampleShares?: Record<string, string>;
  /** Projects already ticked for the chosen-projects choice. */
  sampleChosen?: string[];
  /** The saving story. Rows, fields, the link, and ✕ stay disabled. */
  sampleSaving?: boolean;
  onSave?: (rows: Array<{ project_id: string; share_bp: number }>) => undefined | boolean | Promise<undefined | boolean>;
  /** One project. "left" means the caller already moved on, so this screen does not toast or go back. */
  onOneProject?: (projectId: string) => undefined | boolean | "left" | Promise<undefined | boolean | "left">;
  example?: ReactNode;
  /** Where back goes when this screen was opened directly. */
  backTo?: string;
} = {}) {
  const { transactionId = "" } = useParams();
  const writeGate = useWriteGate(`/transactions/${transactionId}`);
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const location = useLocation();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const invalidate = useInvalidateBooks();
  const goBack = useGoBack();
  const hereRef = useRef("");
  hereRef.current = `${location.pathname}${location.search}${location.hash}`;
  const dashboard = useDashboardQuery(sampleProjects == null);
  const txn = useTransactionQuery(sampleProjects ? "" : transactionId);
  const phase = sampleProjects ? ({ kind: "ready" } as const) : combinePhase(screenPhase(preview, dashboard), screenPhase(preview, txn));
  const projects: SplitProject[] = sampleProjects ?? (dashboard.data?.projects ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    incomeAgorot: project.income_agorot,
    status: project.status,
  }));
  const active = activeProjects(projects);
  const draftId = sampleProjects != null ? `sample${location.search}` : transactionId;
  const restored = sampleMethod === undefined && sampleShares == null ? readSplitDraft(draftId) : null;
  const [method, setMethod] = useState<SplitMethod | null>(restored ? restored.method : (sampleMethod === undefined ? null : sampleMethod));
  const [oneProject, setOneProject] = useState(restored?.oneProject ?? "");
  const [oneOpen, setOneOpen] = useState(false);
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const oneSaved = useRef("");
  const collapseTarget = useRef("");
  const oneUndoId = useRef<string | null>(null);
  const [chosen, setChosen] = useState<string[]>(restored?.chosen ?? sampleChosen ?? []);
  const [manual, setManual] = useState<Record<string, string>>(restored?.manual ?? sampleShares ?? {});
  const [detail, setDetail] = useState(false);
  const [seeded, setSeeded] = useState(restored != null);
  const manualEdited = useRef(sampleShares != null || restored?.method === "manual");
  const priorMethod = useRef<SplitMethod | null>(sampleMethod === "manual" ? null : (sampleMethod ?? null));
  const rowsRef = useRef<Array<{ project_id: string; share_bp: number }>>([]);
  const fallback = backTo ?? `/transactions/${transactionId}${search}`;
  const activeKey = active.map((project) => `${project.id}:${String(project.incomeAgorot ?? 0n)}`).join("|");
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const active = activeRef.current;
    if (seeded || sampleProjects || !txn.data?.allocations?.length || active.length === 0) return;
    const saved: Record<string, number> = {};
    for (const row of txn.data.allocations) saved[row.project_id] = row.share_bp;
    const ids = active.map((project) => project.id);
    if (sameBasis(saved, evenBasis(ids))) {
      setMethod("equal");
      setSeeded(true);
      return;
    }
    if (active.some((project) => (project.incomeAgorot ?? 0n) > 0n) && sameBasis(saved, incomeBasis(active))) {
      setMethod("income");
      setSeeded(true);
      return;
    }
    const picked = ids.filter((id) => (saved[id] ?? 0) > 0);
    if (picked.length >= 2 && picked.length < ids.length && sameBasis(saved, evenBasis(picked))) {
      setChosen(picked);
      setMethod("chosen");
      setSeeded(true);
      return;
    }
    setManual(basisToPercents(ids, saved));
    setMethod("manual");
    manualEdited.current = true;
    setSeeded(true);
  }, [seeded, sampleProjects, txn.data, activeKey]);
  const amount = sampleAmount ?? absAgorot(txn.data?.amount_net ?? 0n);
  const hasIncome = active.some((project) => (project.incomeAgorot ?? 0n) > 0n);
  const evenParts = allocate(amount, active.map((project) => ({ id: project.id, bp: evenBasis(active.map((item) => item.id))[project.id] ?? 0 })));
  const picked = active.filter((project) => chosen.includes(project.id));
  const chosenParts = allocate(amount, picked.map((project) => ({ id: project.id, bp: evenBasis(picked.map((item) => item.id))[project.id] ?? 0 })));
  const incomeParts = allocate(amount, active.map((project) => ({ id: project.id, bp: incomeBasis(active)[project.id] ?? 0 })));
  const manualBasis = Object.fromEntries(active.map((project) => [project.id, percentToBp(manual[project.id] ?? "")]));
  const manualParts = allocate(amount, active.map((project) => ({ id: project.id, bp: manualBasis[project.id] ?? 0 })));
  const manualUsed = active.reduce((sum, project) => sum + (manualBasis[project.id] ?? 0), 0);
  const parts = method === "equal" ? evenParts : method === "chosen" ? chosenParts : method === "income" ? incomeParts : method === "manual" ? manualParts : [];
  const partById = new Map(parts.map((part) => [part.id, part]));
  const overRange = method === "manual" && active.some((project) => percentToBp(manual[project.id] ?? "") > 10000);
  const valid = method === "equal"
    ? evenParts.length > 0 && splitIsValid(evenParts)
    : method === "chosen"
      ? picked.length >= 2 && splitIsValid(chosenParts)
      : method === "income"
        ? hasIncome && splitIsValid(incomeParts)
        : method === "manual"
          ? !overRange && splitIsValid(manualParts)
          : method === "one"
            ? oneProject !== ""
            : false;
  rowsRef.current = sharesForSave(method === "one" ? [] : (valid ? parts : []));
  const baseline = useRef<string | null>(sampleProjects ? "[]" : null);
  if (seeded && baseline.current == null) baseline.current = JSON.stringify(rowsRef.current);
  const dirty = method === "one"
    ? oneProject !== "" && oneSaved.current !== oneProject
    : method != null && (!valid || JSON.stringify(rowsRef.current) !== (baseline.current ?? "[]"));
  const popLeave = useRef(false);
  const save = useWrite({
    failure: projectSplitFailure,
    success: "הפיצול נשמר",
    keys: ["dashboard", "txn", "project"],
    onSuccess: () => {
      clearSplitDraft(draftId);
      if (popLeave.current) return;
      goBack(fallback);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("save_split", { p_transaction_id: transactionId, p_shares: rowsRef.current }));
    },
  });
  const collapseOne = useWrite({
    failure: changeSaveFailure,
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
    onSuccess: () => {
      oneSaved.current = collapseTarget.current;
      setOneProject(collapseTarget.current);
      const id = oneUndoId.current;
      clearSplitDraft(draftId);
      toast.show({
        message: "השיוך נשמר",
        ...(id ? { action: "ביטול", onAction: () => { void undoOne(id); } } : {}),
      });
      if (popLeave.current) return;
      goBack(fallback);
    },
    run: async () => {
      oneUndoId.current = await collapseSplit(transactionId, collapseTarget.current);
    },
  });
  const [saving, setSaving] = useState(false);
  const busy = sampleSaving || saving || save.isPending || collapseOne.isPending;
  const oneProjectRef = useRef(oneProject);
  oneProjectRef.current = oneProject;
  const gate = useRef({ method, valid, dirty, oneProject, manual, chosen });
  gate.current = { method, valid, dirty, oneProject, manual, chosen };
  const warned = useRef(false);
  const discardClose = useRef(false);
  const releasePop = useRef(false);
  const inflight = useRef<Promise<unknown> | null>(null);
  function rememberDraft() {
    const now = gate.current;
    writeSplitDraft(draftId, {
      method: now.method,
      manual: now.manual,
      chosen: now.chosen,
      oneProject: now.oneProject,
    });
  }
  function blockedChoice(): boolean {
    const now = gate.current;
    if (now.method == null) return false;
    if (now.method === "one") return now.oneProject === "";
    return !now.valid;
  }
  async function undoOne(id: string) {
    const supabase = getSupabase();
    if (!supabase) {
      toast.show({ tone: "bad", message: "לא הצלחנו לבטל את השיוך." });
      return;
    }
    const saved = await supabase.rpc("undo_reassign", { p_id: id });
    if (saved.error) {
      toast.show({ tone: "bad", message: "לא הצלחנו לבטל את השיוך." });
      return;
    }
    await invalidate(["txn", "dashboard", "project", "project-category", "project-waiting", "review"]);
    toast.show({ message: "השיוך הקודם חזר" });
  }
  async function collapseNow(projectId: string): Promise<undefined | "left"> {
    if (projectId === "") throw new Error("supabase");
    if (onOneProject) {
      const outcome = await onOneProject(projectId);
      if (outcome === false) throw new Error("save");
      oneSaved.current = projectId;
      setOneProject(projectId);
      return outcome === "left" ? "left" : undefined;
    }
    if (sampleProjects) {
      oneSaved.current = projectId;
      setOneProject(projectId);
      toast.show({
        message: "השיוך נשמר",
        action: "ביטול",
        onAction: () => {
          oneSaved.current = "";
          setOneProject("");
          setMethod(null);
        },
      });
      return undefined;
    }
    if (blocked()) throw new Error("preview");
    collapseTarget.current = projectId;
    await collapseOne.mutateAsync();
    return "left";
  }
  function abandon() {
    discardClose.current = true;
    clearSplitDraft(draftId);
    goBack(fallback);
  }
  async function leave() {
    if (sampleSaving) return;
    if (inflight.current) {
      try {
        await inflight.current;
      } catch {
        // The failure toast is already up. The dismiss still closes.
      }
      if (!discardClose.current) goBack(fallback);
      return;
    }
    if (!blockedChoice()) warned.current = false;
    if (blockedChoice()) {
      if (!warned.current) {
        warned.current = true;
        return;
      }
      abandon();
      return;
    }
    if (gate.current.method === "one") {
      if (oneSaved.current === gate.current.oneProject) {
        clearSplitDraft(draftId);
        goBack(fallback);
        return;
      }
      rememberDraft();
      try {
        const work = collapseNow(gate.current.oneProject);
        inflight.current = work;
        const outcome = await work;
        if (outcome !== "left" && oneSaved.current === gate.current.oneProject) {
          clearSplitDraft(draftId);
          goBack(fallback);
        }
      } catch {
        return;
      } finally {
        inflight.current = null;
      }
      return;
    }
    if (gate.current.dirty && gate.current.valid) {
      rememberDraft();
      if (onSave) {
        setSaving(true);
        try {
          const work = Promise.resolve(onSave(rowsRef.current));
          inflight.current = work;
          const saved = await work;
          if (saved === false) return;
        } catch (error) {
          if (hasCategorySplit(error)) {
            toast.show({ tone: "bad", message: LINE_HAS_CATEGORY_SPLIT });
            return;
          }
          toast.show({ tone: "bad", message: "הפיצול לא נשמר", action: "ניסיון חוזר", onAction: () => { void leave(); } });
          return;
        } finally {
          inflight.current = null;
          setSaving(false);
        }
        clearSplitDraft(draftId);
        baseline.current = JSON.stringify(rowsRef.current);
        gate.current = { ...gate.current, valid: true, dirty: false };
        return;
      }
      if (blocked()) return;
      if (sampleProjects) {
        clearSplitDraft(draftId);
        goBack(fallback);
        return;
      }
      try {
        const work = save.mutateAsync();
        inflight.current = work;
        await work;
      } catch {
        return;
      } finally {
        inflight.current = null;
      }
      return;
    }
    clearSplitDraft(draftId);
    goBack(fallback);
  }
  const popApi = useRef({
    blocked,
    draftId,
    onSave,
    sampleProjects,
    save,
    collapseNow,
    toast,
    rememberDraft,
    blockedChoice,
  });
  popApi.current = {
    blocked,
    draftId,
    onSave,
    sampleProjects,
    save,
    collapseNow,
    toast,
    rememberDraft,
    blockedChoice,
  };
  useEffect(() => {
    function holdPop(event: PopStateEvent, splitUrl: string) {
      event.stopImmediatePropagation();
      window.history.pushState(window.history.state, "", splitUrl);
    }
    function leavePop() {
      releasePop.current = true;
      window.history.back();
    }
    function onPop(event: PopStateEvent) {
      const api = popApi.current;
      if (releasePop.current) {
        releasePop.current = false;
        return;
      }
      const splitUrl = hereRef.current;
      if (discardClose.current) return;
      if (api.blockedChoice()) {
        if (!warned.current) {
          warned.current = true;
          holdPop(event, splitUrl);
          return;
        }
        clearSplitDraft(api.draftId);
        return;
      }
      const now = gate.current;
      if (!now.dirty || !now.valid) return;
      holdPop(event, splitUrl);
      api.rememberDraft();
      popLeave.current = true;
      const work = (async () => {
        try {
          if (now.method === "one") {
            await api.collapseNow(now.oneProject);
            clearSplitDraft(api.draftId);
            leavePop();
            return;
          }
          if (api.onSave) {
            const saved = await api.onSave(rowsRef.current);
            if (saved === false) {
              popLeave.current = false;
              return;
            }
            clearSplitDraft(api.draftId);
            leavePop();
            return;
          }
          if (api.sampleProjects || api.blocked()) return;
          await api.save.mutateAsync();
          clearSplitDraft(api.draftId);
          leavePop();
        } catch {
          popLeave.current = false;
          api.toast.show({ tone: "bad", message: "הפיצול לא נשמר" });
        }
      })();
      inflight.current = work;
      void work.finally(() => {
        if (inflight.current === work) inflight.current = null;
      });
    }
    // The module listener is already on window, so a later pop cannot miss it.
    splitPop = onPop;
    return () => {
      if (splitPop === onPop) splitPop = null;
    };
  }, []);
  function openManual() {
    if (busy) return;
    if (method !== "manual") priorMethod.current = method;
    if (!manualEdited.current && method && method !== "manual") {
      const source = method === "income" ? incomeBasis(active) : evenBasis((method === "chosen" ? picked : active).map((project) => project.id));
      const ids = (method === "chosen" ? picked : active).map((project) => project.id);
      setManual(basisToPercents(ids, source));
      manualEdited.current = true;
    }
    setMethod("manual");
  }
  function focusShare(event: { currentTarget: HTMLDivElement; target: EventTarget }) {
    if (busy) return;
    if (event.target instanceof HTMLElement && event.target.closest("input")) return;
    event.currentTarget.querySelector("input")?.focus();
  }
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  if (phase.kind !== "ready" || active.length === 0) {
    return (
      <ScreenState
        title="פיצול בין פרויקטים"
        backTo={fallback}
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        onRetry={() => { void dashboard.refetch(); void txn.refetch(); }}
        empty={<EmptyState icon={<ProjectsIcon />} title="אין פרויקטים לפיצול" body="פיצול מחכה לפרויקט אחד לפחות." />}
      />
    );
  }
  const meta = sampleMeta ?? [txn.data?.supplier_name, txn.data?.doc_date ? formatDisplay(txn.data.doc_date) : ""].filter(Boolean).join(" · ");
  const allLine = evenSentence(evenParts, amount);
  const chosenLine = picked.length === 0 ? "בוחרים פרויקטים, והסכום מתחלק שווה" : evenSentence(chosenParts, amount);
  const manualLeft = 10000 - manualUsed;
  const manualStatus = manualLeft > 0
    ? `נשארו ${percentWords(manualLeft)}% לפצל`
    : manualLeft < 0
      ? `הסך ${percentWords(manualUsed)}%. צריך 100%.`
      : "הסך 100%";
  const oneName = [...active, ...extraProjects].find((project) => project.id === oneProject)?.name ?? "";
  const summary = !method
    ? "בחרו איך לפצל"
    : method === "one" && oneProject === ""
      ? COLLAPSE_PICK_HOLD
      : method === "one"
        ? `${oneName} · ${ONE_PROJECT_DETAIL}`
        : method === "chosen" && picked.length < 2
          ? "בחרו לפחות 2 פרויקטים"
          : method === "chosen"
            ? chosenLine
            : method === "manual" && !valid
              ? manualStatus
              : method === "manual"
                ? `פיצול ידני · ${String(manualParts.length)} פרויקטים`
                : method === "income"
                  ? `לפי הכנסות · ${String(incomeParts.length)} פרויקטים`
                  : allLine;
  const summaryIdle = method != null && !valid;
  const showDetail = method === "equal" || (method === "income" && hasIncome);
  const detailParts = method === "income" ? incomeParts : evenParts;
  const pickerProjects: ChangeChoice[] = [
    ...active.map((project) => ({ id: project.id, name: project.name, status: project.status })),
    ...extraProjects.filter((project) => !active.some((item) => item.id === project.id)),
  ];
  return (
    <>
    <form
      className="ui-split"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        void leave();
      }}
    >
      <ScreenHeader
        layout="stacked"
        title="פיצול בין פרויקטים"
        leading={<IconButton label="סגירה" disabled={sampleSaving} onClick={() => { void leave(); }}><CloseIcon /></IconButton>}
        trailing={example}
      />
      <div className="ui-split-amount">
        <p className="t-display"><BigNumber agorot={amount} presentation="detail" currency={txn.data?.currency} /></p>
        {meta ? <p className="ui-split-meta t-label">{meta}</p> : null}
      </div>
      <h2 className="ui-split-question t-title-3">איך לפצל?</h2>
      <fieldset className="ui-split-body" disabled={busy}>
        <div className="ui-split-card" role="radiogroup" aria-label="איך לפצל?">
          <RadioRow marker="start" label="שווה בין כל הפרויקטים" description={allLine} selected={method === "equal"} busy={busy && method === "equal"} disabled={busy && method !== "equal"} onSelect={() => { setMethod("equal"); }} />
          <RadioRow marker="start" label="שווה בין פרויקטים שאבחר" description={chosenLine} selected={method === "chosen"} busy={busy && method === "chosen"} disabled={busy && method !== "chosen"} onSelect={() => { setMethod("chosen"); }} />
          <RadioRow
            marker="start"
            label="לפי הכנסות"
            description={hasIncome ? "לפי ההכנסות של כל פרויקט בתקופה" : undefined}
            disabledReason={hasIncome ? undefined : "אין הכנסות בתקופה הזו"}
            disabled={busy && method !== "income"}
            selected={method === "income"}
            busy={busy && method === "income"}
            onSelect={() => { setMethod("income"); }}
          />
          <RadioRow
            marker="start"
            label={ONE_PROJECT_OPTION}
            description={ONE_PROJECT_DETAIL}
            disabled={busy && method !== "one"}
            selected={method === "one"}
            busy={busy && method === "one"}
            onSelect={() => {
              setMethod("one");
              setOneOpen(true);
            }}
          />
        </div>
        {method === "chosen" ? (
          <div className="ui-split-card ui-split-detail">
            {active.map((project) => {
              const on = chosen.includes(project.id);
              const part = partById.get(project.id);
              return (
                <CheckRow
                  key={project.id}
                  label={project.name}
                  checked={on}
                  disabled={busy}
                  value={on && part ? formatShare(part.agorot) : undefined}
                  onChange={(next) => {
                    setChosen((current) => next ? [...current, project.id] : current.filter((id) => id !== project.id));
                  }}
                />
              );
            })}
          </div>
        ) : null}
        {showDetail ? (
          <div className="ui-split-detail">
            <p className="ui-split-link">
              <TextLink chevron={false} expanded={detail} disabled={busy} onClick={() => { setDetail((open) => !open); }}>
                {detail ? "הסתרת הפירוט" : "הצגת הפירוט"}
              </TextLink>
            </p>
            {detail ? (
              <div className="ui-split-card">
                {detailParts.map((part) => {
                  const project = active.find((item) => item.id === part.id);
                  if (!project) return null;
                  return <CheckRow key={part.id} readOnly label={project.name} value={formatShare(part.agorot)} />;
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        {method === "manual" ? (
          <div className="ui-split-card ui-split-detail">
            {active.map((project, index) => {
              const raw = manual[project.id] ?? "";
              const bp = percentToBp(raw);
              const part = partById.get(project.id);
              return (
                <div
                  key={project.id}
                  className="ui-split-manual"
                  onMouseDown={(event) => {
                    if (event.target instanceof HTMLElement && event.target.closest("input")) return;
                    event.preventDefault();
                  }}
                  onClick={(event) => { focusShare(event); }}
                >
                  <span className="ui-row-title">{project.name}</span>
                  <span className="ui-split-manual-end">
                    <PercentField
                      hideLabel
                      id={`split-pct-${project.id}`}
                      name={`split-pct-${project.id}`}
                      label={`אחוז, ${project.name}`}
                      value={raw}
                      disabled={busy}
                      error={bp > 10000 ? "עד 100%" : undefined}
                      enterKeyHint={index === active.length - 1 ? "done" : "next"}
                      onValueChange={(next) => {
                        manualEdited.current = true;
                        setManual({ ...manual, [project.id]: next });
                      }}
                    />
                    {part ? <p className="ui-split-manual-money t-label">{formatShare(part.agorot)}</p> : null}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        <p className="ui-split-link">
          {method === "manual" ? (
            <TextLink chevron={false} disabled={busy} onClick={() => { setMethod(priorMethod.current); }}>חזרה לאפשרויות</TextLink>
          ) : (
            <TextLink chevron={false} disabled={busy} onClick={openManual}>פיצול ידני</TextLink>
          )}
        </p>
        {method === "manual" && valid ? <p className="ui-split-remain t-label">הסך 100%</p> : null}
      </fieldset>
      <div className="ui-split-cta">
        {summaryIdle ? (
          <HoldLine onDiscard={abandon}>
            {method === "manual" && manualLeft < 0 ? (
              <>
                {"הסך "}
                <bdi className="ui-split-bad" dir="ltr">{`${percentWords(manualUsed)}%`}</bdi>
                {". צריך 100%."}
              </>
            ) : summary}
          </HoldLine>
        ) : (
          <p className="ui-split-summary t-body">{summary}</p>
        )}
      </div>
    </form>
    <ChangeAssignment
      host="overlay"
      open={oneOpen}
      onOpenChange={setOneOpen}
      contained
      start="project"
      supplier=""
      amount={formatIls(amount)}
      direction="expense"
      projects={pickerProjects}
      categories={[]}
      projectId={oneProject}
      categoryId=""
      onProjectId={setOneProject}
      onCategoryId={() => undefined}
      projectNote={COLLAPSE_SPLIT_NOTE}
      hideSplitLink
      onCommitPick={(_kind, id) => collapseNow(id)}
      onSplit={() => { setOneOpen(false); }}
      onCreateProject={async (name) => {
        if (sampleProjects != null) {
          const created = { id: `split-extra-${String(extraProjects.length + 1)}`, name, status: "active" as const };
          setExtraProjects((list) => [...list, created]);
          return created;
        }
        return saveNewProject(name, blocked, toast, (project) => {
          setExtraProjects((list) => [...list, project]);
        }, invalidate);
      }}
    />
    </>
  );
}

/** Shown on `/settings?preview=` when the value is not `empty` and no sample is passed. */
const previewAccountName = "בית הספר אלון";
const previewAccountEmail = "owner@example.com";

type SettingsSample = {
  name: string | null;
  connected: boolean;
  companyId: number | null;
  lastError: string | null;
  nextAttemptAt?: string | null;
  email?: string | null;
  /** Shown in the connected sheet when present. A missing time is omitted. */
  lastSyncAt?: string | null;
  /** Live `company_id` is null. Preview passes this because a sample skips the dashboard. */
  noCompany?: boolean;
  /** Story fixture. Live status comes from the query. */
  sumit?: "loading" | "error";
  mercury?: "loading" | "error";
  mercuryConnected?: boolean;
  mercuryLastError?: string | null;
  mercuryLastSyncAt?: string | null;
  assistant?: AssistantSample;
  jev?: JevCardState;
  /** Preview only. Live settings read the company's lines. */
  loanCurrency?: LoanCurrency;
  /** FLOW-119. Projects for the loan's project picker. */
  loanProjects?: LoanProjectChoice[];
  /** FLOW-501. The Loans page and the Settings הלוואות hint. */
  loans?: LoanRowsSample;
};

type SumitKind = "loading" | "error" | "reconnect" | "connected" | "disconnected";

function sumitKind(input: {
  forced: "loading" | "error" | null;
  noCompany: boolean;
  statusLoading: boolean;
  statusFailed: boolean;
  authReconnect: boolean;
  connected: boolean;
}): SumitKind {
  if (input.forced === "loading") return "loading";
  if (input.forced === "error") return "error";
  if (input.noCompany) return "disconnected";
  if (input.statusLoading) return "loading";
  if (input.statusFailed) return "error";
  if (input.authReconnect) return "reconnect";
  if (input.connected) return "connected";
  return "disconnected";
}

/** Connections → onboarding, then back to Connections with the SUMIT sheet open. */
function onboardingFromSettings(search: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : "");
  params.set("return", "/settings/connections?sheet=sumit");
  return `/onboarding?${params.toString()}`;
}

const REFRESH_DONE = "הרענון הסתיים.";
const SUMIT_REFRESH_KEYS = ["sumit", "dashboard", "unpaid", "review", "project"];
const MERCURY_REFRESH_KEYS = ["mercury", "dashboard", "unpaid", "review", "project"];

/** FLOW-501. Invented loans for `?preview=1`. */
const PREVIEW_LOANS: LoanBalanceRow[] = [
  { id: "preview-loan-1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 0, projectId: "preview-alon", projectName: "וילה אלון" },
  { id: "preview-loan-2", name: "הלוואת ציוד", currency: "ILS", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: "preview-gefen", projectName: "פרויקט גפן" },
];

/** One connector as the Settings חיבורים hint counts it (FLOW-501). */
export type ConnectorTally = { name: string; state: "loading" | "error" | "active" | "off" | "reconnect" };

export type ConnectionsHint =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "attention"; text: string }
  | { kind: "count"; active: number; total: number };

/**
 * The Settings חיבורים hint: "N מתוך M פעילים", or the one connector that needs
 * reconnecting, or how many do. Loading and a failed read win, so the count is
 * never a guess. The retry lives on the page.
 */
export function connectionsHint(list: readonly ConnectorTally[]): ConnectionsHint {
  if (list.some((item) => item.state === "loading")) return { kind: "loading" };
  if (list.some((item) => item.state === "error")) return { kind: "error" };
  const broken = list.filter((item) => item.state === "reconnect");
  if (broken.length === 1) return { kind: "attention", text: `${broken[0]?.name ?? ""}: צריך לחבר מחדש` };
  if (broken.length > 1) return { kind: "attention", text: `${String(broken.length)} חיבורים צריכים חיבור מחדש` };
  return { kind: "count", active: list.filter((item) => item.state === "active").length, total: list.length };
}

/** The Settings הלוואות hint: the count, never a total (mixed currencies have none). */
export function loansCountHint(count: number): ReactNode {
  if (count === 0) return "אין הלוואות עדיין";
  if (count === 1) return "הלוואה אחת";
  return <><bdi className="ui-num" dir="ltr">{String(count)}</bdi> הלוואות</>;
}

function queryTally(
  name: string,
  query: { isLoading: boolean; isError: boolean; data: unknown },
  ready: () => ConnectorTally["state"],
): ConnectorTally {
  if (query.isLoading) return { name, state: "loading" };
  if (query.isError && query.data == null) return { name, state: "error" };
  return { name, state: ready() };
}

function assistantTally(sample: AssistantSample): ConnectorTally["state"] {
  if (sample.state === "loading") return "loading";
  if (sample.state === "error" || sample.error === true) return "error";
  if (sample.state === "connected") return "active";
  if (sample.state === "expired") return "reconnect";
  return "off";
}

/** The page Back returns to, so Settings can put focus back on its row. */
let settingsOpened: "connections" | "loans" | null = null;

/**
 * `/settings` (0082, amended by 0116): the account rows, then one quiet group
 * with חיבורים and הלוואות, then תצוגה and עוד. An old `?sheet=` link moves to
 * the Connections page with its query, so the sheet still opens there.
 */
export function SettingsScreen(props: { sample?: SettingsSample } = {}) {
  const [params] = useSearchParams();
  const location = useLocation();
  const sheet = params.get("sheet");
  if (sheet === "sumit" || sheet === "mercury" || sheet === "assistant" || sheet === "jev") {
    return <Navigate to={{ pathname: "/settings/connections", search: location.search }} replace state={location.state as unknown} />;
  }
  return <SettingsHome sample={props.sample} />;
}

function SettingsHome({ sample }: { sample?: SettingsSample }) {
  const preview = useHomePreview();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const previewValue = params.get("preview");
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const { session } = useAuth();
  const holdWrites = useHoldWrites();
  const blocked = useBlockedPreview();
  const dashboard = useDashboardQuery(sample == null);
  const signedInUserId = session?.user.id;
  const signedInCompanyId = dashboard.data?.company_id;
  const setupEntry = useSetupSettingsEntry(signedInUserId ?? null, signedInCompanyId ?? null);
  if (signedInUserId && signedInCompanyId) {
    bindJevConnectorScope({ userId: signedInUserId, companyId: signedInCompanyId });
  }
  const live = sample == null && preview === "off";
  const liveCompanyId = live ? (signedInCompanyId ?? null) : null;
  const liveCompany = liveCompanyId != null;
  const sumit = useSumitStatusQuery(sample == null && (preview !== "off" || signedInCompanyId != null));
  const mercury = useMercuryStatusQuery(sample == null && (preview !== "off" || signedInCompanyId != null));
  const jev = useJevIntegrationQuery(liveCompany);
  const assistant = useAssistantStatusQuery(liveCompany);
  const loans = useLoanBalances(liveCompanyId);
  const [renameOpen, setRenameOpen] = useState(false);
  const businessRowRef = useRef<HTMLButtonElement>(null);
  const setRenameSheet = useSheetHistory("company-rename", renameOpen, setRenameOpen);
  const [overheadOn, setOverheadOn] = useState(false);
  const wantedOverhead = useRef(false);
  useEffect(() => {
    if (sample) return;
    if (dashboard.data) setOverheadOn(dashboard.data.after_overhead === true);
  }, [sample, dashboard.data]);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, dashboard);
  // Back from a page puts focus on the row that opened it. A fresh visit does not.
  // Read once per mount: StrictMode reruns the effect after the title has taken focus.
  const [openedPage] = useState(() => settingsOpened);
  useEffect(() => {
    settingsOpened = null;
    // The rows draw once the screen stops loading, in a preview too.
    if (phase.kind === "loading") return;
    if (openedPage == null || navigationType !== NavigationType.Pop) return;
    const row = document.querySelector<HTMLElement>(`[data-settings-page="${openedPage}"] a`);
    row?.focus({ preventScroll: true });
  }, [phase.kind, navigationType, openedPage]);
  const saveOverhead = useWrite({
    failure: "לא הצלחנו לשמור את התצוגה.",
    keys: ["dashboard", "project"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_after_overhead", { p_on: wantedOverhead.current }));
    },
  });
  const signOut = useWrite({
    failure: "לא הצלחנו לצאת.",
    keys: [],
    onSuccess: () => { void navigate("/sign-in"); },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      clearJevConnectorFlag(session?.user.id ?? null);
      queryClient.removeQueries({ queryKey: ["jev-connector"] });
      queryClient.removeQueries({ queryKey: ["company-owner"] });
    },
  });

  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="הגדרות"
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
      />
    );
  }

  const noCompany = sample
    ? sample.noCompany === true
    : previewValue === "empty" || (preview === "off" && dashboard.data?.company_id == null);
  const previewSample = sample == null && preview !== "off" && previewValue !== "empty";
  const businessName = sample ? sample.name : previewSample ? previewAccountName : dashboard.data?.name;
  const email = (sample ? sample.email : previewSample ? previewAccountEmail : session?.user.email)?.trim() ?? "";
  const namedBusiness = (businessName ?? "").trim();
  const showInstall = !isStandalone();
  const showSignOut = preview === "off" || previewValue === "empty";

  const tallies: ConnectorTally[] = sample
    ? [
      { name: "SUMIT", state: sample.sumit ?? (sample.lastError === "sumit_auth" ? "reconnect" : sample.connected ? "active" : "off") },
      { name: "Mercury", state: sample.mercury ?? (sample.mercuryLastError === "auth" ? "reconnect" : sample.mercuryConnected === true ? "active" : "off") },
      { name: "תיוג חכם", state: (() => {
        const state = sample.jev ?? JEV_DEFAULT;
        if (state.status === "loading" || state.status === "error") return state.status;
        return jevSwitchOn(state) ? "active" : "off";
      })() },
      { name: "עוזר AI", state: assistantTally(sample.assistant ?? { state: "empty" }) },
    ]
    : [
      queryTally("SUMIT", sumit, () => (sumit.data?.last_error === "sumit_auth" ? "reconnect" : sumit.data?.connected === true ? "active" : "off")),
      queryTally("Mercury", mercury, () => (mercury.data?.last_error === "auth" ? "reconnect" : mercury.data?.connected === true ? "active" : "off")),
      queryTally("תיוג חכם", jev, () => (jev.data != null && jevSwitchOn({ ...jev.data, status: "ready" }) ? "active" : "off")),
      queryTally("עוזר AI", assistant, () => {
        const state = assistant.data?.state;
        return state === "connected" ? "active" : state === "expired" ? "reconnect" : "off";
      }),
    ];
  // A viewer cannot reconnect, so an expired connector reads as off (V29).
  const hint = connectionsHint(holdWrites
    ? tallies.map((item) => (item.state === "reconnect" ? { ...item, state: "off" as const } : item))
    : tallies);
  const connectionsRowHint: ReactNode = noCompany
    ? "אין עסק עדיין"
    : hint.kind === "loading"
      ? <Skeleton width="sm" />
      : hint.kind === "error"
        ? "לא הצלחנו לטעון"
        : hint.kind === "attention"
          ? hint.text
          : <><bdi className="ui-num" dir="ltr">{String(hint.active)}</bdi> מתוך <bdi className="ui-num" dir="ltr">{String(hint.total)}</bdi> פעילים</>;
  const connectionsWarning = !noCompany && hint.kind === "attention";

  const loanSample: LoanRowsSample | undefined = sample
    ? (sample.loans ?? [])
    : preview !== "off"
      ? (previewValue === "empty" ? [] : PREVIEW_LOANS)
      : undefined;
  const loansLoading = loanSample === "loading" || (loanSample == null && (loans.isLoading || (dashboard.isFetching && signedInCompanyId == null)));
  const loansFailed = loanSample === "error" || (loanSample == null && loans.isError);
  const loanCount = Array.isArray(loanSample) ? loanSample.length : (loans.data ?? []).length;
  const loansRowHint: ReactNode = loansLoading
    ? <Skeleton width="sm" />
    : loansFailed
      ? "לא הצלחנו לטעון"
      : loansCountHint(loanCount);

  return (
    <ViewerScope>
    <div>
      <ScreenHeader title="הגדרות" />
      <ViewerNote />
      {noCompany ? (
        email !== "" ? (
          <List>
            <ListRow variant="static" title={email} ltrTitle icon={<GoogleIcon />} />
          </List>
        ) : null
      ) : namedBusiness !== "" ? (
        <List>
          {holdWrites ? (
            <ListRow variant="static" title={namedBusiness} icon={<BuildingIcon />} />
          ) : (
            <ListRow
              variant="button"
              title={namedBusiness}
              label={`שם העסק: ${namedBusiness}`}
              icon={<BuildingIcon />}
              chevron
              buttonRef={businessRowRef}
              onClick={() => { setRenameSheet(true); }}
            />
          )}
          {email !== "" ? <ListRow variant="static" title={email} ltrTitle icon={<GoogleIcon />} /> : null}
        </List>
      ) : null}
      {!noCompany && !holdWrites && namedBusiness !== "" ? (
        <RenameCompanySheet
          open={renameOpen}
          onOpenChange={(next) => { setRenameSheet(next); }}
          companyId={sample || previewSample ? null : dashboard.data?.company_id ?? null}
          currentName={namedBusiness}
          blocked={() => blocked(sample != null ? "empty" : undefined)}
          returnFocusRef={businessRowRef}
        />
      ) : null}
      <List>
        <SettingsPageRow
          page="connections"
          href={`/settings/connections${search}`}
          title="חיבורים"
          icon={connectionsWarning ? <AlertIcon size={24} /> : <PlugIcon />}
          hint={connectionsRowHint}
          skeleton={!noCompany && hint.kind === "loading"}
          warning={connectionsWarning}
        />
        {noCompany ? null : (
          <SettingsPageRow
            page="loans"
            href={`/settings/loans${search}`}
            title="הלוואות"
            icon={<LoanIcon />}
            hint={loansRowHint}
            skeleton={loansLoading}
          />
        )}
      </List>
      {noCompany ? null : (
        <>
          <SectionHead title="תצוגה" />
          <List>
            <ListRow variant="item" href={`/settings/categories${search}`} title="קטגוריות" icon={<TagIcon />} chevron />
            <Toggle
              label="רווח אחרי כלליות"
              hint="חלק מהכלליות נכנס לכל פרויקט"
              icon={<SplitIcon />}
              checked={overheadOn}
              disabled={holdWrites}
              onChange={(checked) => {
                if (holdWrites) return;
                if (sample) {
                  setOverheadOn(checked);
                  return;
                }
                if (blocked()) return;
                const previous = overheadOn;
                setOverheadOn(checked);
                wantedOverhead.current = checked;
                saveOverhead.mutate(undefined, { onError: () => { setOverheadOn(previous); } });
              }}
            />
          </List>
        </>
      )}
      {showInstall || showSignOut || (setupEntry != null && !holdWrites) ? (
        <>
          <SectionHead title="עוד" />
          <List>
            {setupEntry && !holdWrites ? (
              <ListRow
                variant="item"
                href={setupEntry.href}
                title="הגדרה ראשונה"
                hint={<><bdi className="ui-num" dir="ltr">{String(setupEntry.done)}</bdi> מתוך <bdi className="ui-num" dir="ltr">5</bdi></>}
                describeHint
                chevron
              />
            ) : null}
            {showInstall ? (
              <ListRow variant="item" href={`/install${search}`} title="התקנה למסך הבית" hint="נפתח כמו אפליקציה" icon={<DownloadIcon />} chevron />
            ) : null}
            {showSignOut ? (
              <ListRow
                variant="danger"
                title="התנתקות"
                icon={<LogoutIcon />}
                busy={signOut.isPending}
                onClick={() => {
                  signOut.mutate();
                }}
              />
            ) : null}
          </List>
        </>
      ) : null}
      <p className="ui-poc t-hint"><bdi dir="ltr">Flow 0.1</bdi></p>
    </div>
    </ViewerScope>
  );
}

/** A Settings row that opens a page. Viewers navigate too: reading is allowed (§2.8). */
function SettingsPageRow({
  page,
  href,
  title,
  icon,
  hint,
  skeleton = false,
  warning = false,
}: {
  page: "connections" | "loans";
  href: string;
  title: string;
  icon: ReactNode;
  hint: ReactNode;
  skeleton?: boolean;
  warning?: boolean;
}) {
  return (
    <span
      className="ui-settings-page-row"
      data-settings-page={page}
      onClickCapture={() => { settingsOpened = page; }}
    >
      <ListRow
        variant="item"
        href={href}
        title={title}
        icon={icon}
        hint={hint}
        skelHint={skeleton}
        describeHint={!skeleton}
        wrapHint
        tone={warning ? "warning" : undefined}
        chevron
      />
    </span>
  );
}

/**
 * `/settings/loans` (FLOW-501): the balances and הלוואה חדשה, moved out of
 * Settings. Viewers read the balances (U10). No company goes back to Settings,
 * like Categories. `/settings/loans/:id` is kept for FLOW-110's detail page.
 */
export function LoansScreen({ sample }: { sample?: SettingsSample } = {}) {
  const preview = useHomePreview();
  const [params] = useSearchParams();
  const previewValue = params.get("preview");
  const search = usePreviewSearch();
  const blocked = useBlockedPreview();
  const dashboard = useDashboardQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, dashboard);
  const previewNoCompany = sample == null && previewValue === "empty";
  const sampleNoCompany = sample?.noCompany === true;
  const liveNoCompany = sample == null && preview === "off" && dashboard.isSuccess && dashboard.data.company_id == null;
  if (previewNoCompany || sampleNoCompany || liveNoCompany) {
    return <Navigate to={`/settings${search}`} replace />;
  }
  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="הלוואות"
        kicker="הגדרות"
        backTo={`/settings${search}`}
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
        loading={(
          <List>
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
          </List>
        )}
      />
    );
  }
  const sampled = sample != null || preview !== "off";
  return (
    <ViewerScope>
    <div>
      <ScreenHeader title="הלוואות" kicker="הגדרות" backTo={`/settings${search}`} />
      <ViewerNote />
      <LoanSettingsSection
        companyId={sampled ? null : (dashboard.data?.company_id ?? null)}
        companyCurrency={sampled ? (sample?.loanCurrency ?? "ILS") : undefined}
        blocked={blocked}
        sample={sample ? (sample.loans ?? []) : preview !== "off" ? PREVIEW_LOANS : undefined}
        projects={sampled
          ? { rows: sample?.loanProjects ?? [] }
          : {
            rows: (dashboard.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name, status: project.status, code: project.code })),
            loading: dashboard.isLoading,
            error: dashboard.isError,
            retrying: dashboard.isFetching,
            onRetry: () => { void dashboard.refetch(); },
          }}
      />
    </div>
    </ViewerScope>
  );
}

/** A connector's one-word status (0082 §3). */
function connectorWord(kind: SumitKind): string {
  if (kind === "reconnect") return "צריך לחבר מחדש";
  if (kind === "connected") return "מחובר";
  return "לא מחובר";
}

/**
 * `/settings/connections` (FLOW-501): SUMIT and Mercury under ספרים ובנק,
 * Jev and the assistant under עזרים. The rows, sheets and focus returns moved
 * here from Settings unchanged. `?sheet=sumit|mercury|assistant` opens one.
 */
export function ConnectionsScreen({
  sample,
  sampleSecret,
}: {
  sample?: SettingsSample;
  /** Dev route only. Production preview never mints a local code. */
  sampleSecret?: string;
} = {}) {
  const preview = useHomePreview();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const previewValue = params.get("preview");
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const { session } = useAuth();
  const viewer = useIsViewer();
  const holdWrites = useHoldWrites();
  const blocked = useBlockedPreview();
  const status = useSumitStatusQuery(sample == null);
  const mercuryStatus = useMercuryStatusQuery(sample == null);
  const dashboard = useDashboardQuery(sample == null);
  const signedInUserId = session?.user.id;
  const signedInCompanyId = dashboard.data?.company_id;
  if (signedInUserId && signedInCompanyId) {
    bindJevConnectorScope({ userId: signedInUserId, companyId: signedInCompanyId });
  }
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mercuryApiKey, setMercuryApiKey] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [mercuryConnectOpen, setMercuryConnectOpen] = useState(false);
  const [mercuryStatusOpen, setMercuryStatusOpen] = useState(false);
  const [mercuryDisconnectOpen, setMercuryDisconnectOpen] = useState(false);
  const adoptSheet = useRef(false);
  const setConnectSheet = useSheetHistory("sumit-connect", connectOpen, setConnectOpen, undefined, adoptSheet);
  const setStatusSheet = useSheetHistory("sumit-status", statusOpen, setStatusOpen, undefined, adoptSheet);
  const setDisconnectSheet = useSheetHistory("sumit-disconnect", disconnectOpen, setDisconnectOpen);
  // Every close path (✕, Escape, Back, success) drops the pasted token.
  const setMercuryConnectOpenClearing = useCallback((open: boolean) => {
    if (!open) setMercuryApiKey("");
    setMercuryConnectOpen(open);
  }, []);
  const setMercuryConnectSheet = useSheetHistory("mercury-connect", mercuryConnectOpen, setMercuryConnectOpenClearing, undefined, adoptSheet);
  const setMercuryStatusSheet = useSheetHistory("mercury-status", mercuryStatusOpen, setMercuryStatusOpen, undefined, adoptSheet);
  const setMercuryDisconnectSheet = useSheetHistory("mercury-disconnect", mercuryDisconnectOpen, setMercuryDisconnectOpen);
  const [clockNow, setClockNow] = useRefreshingNow();
  const [focusSumit, setFocusSumit] = useState(false);
  const [focusMercury, setFocusMercury] = useState(false);
  const [sumitRetrying, setSumitRetrying] = useState(false);
  const [mercuryRetrying, setMercuryRetrying] = useState(false);
  const [sumitHint, setSumitHint] = useState("לא הצלחנו לטעון");
  const [mercuryHint, setMercuryHint] = useState("לא הצלחנו לטעון");
  const [sumitOffline, setSumitOffline] = useState(0);
  const [mercuryOffline, setMercuryOffline] = useState(0);
  const [sumitNonce, setSumitNonce] = useState(0);
  const [mercuryNonce, setMercuryNonce] = useState(0);
  const sumitRowRef = useRef<HTMLButtonElement>(null);
  const sumitRetryRef = useRef<HTMLButtonElement>(null);
  const sumitDisconnectRef = useRef<HTMLButtonElement>(null);
  const mercuryRowRef = useRef<HTMLButtonElement>(null);
  const mercuryRetryRef = useRef<HTMLButtonElement>(null);
  const mercuryDisconnectRef = useRef<HTMLButtonElement>(null);
  const sheetApplied = useRef(false);
  const wantSheet = useRef<"sumit" | "mercury" | null>(null);
  const retrySource = sample ? sample.nextAttemptAt : status.data?.next_attempt_at;
  useEffect(() => {
    if (!retrySource) return;
    const at = Date.parse(retrySource);
    const wait = at - Date.now();
    if (!Number.isFinite(wait) || wait <= 0) return;
    const id = window.setTimeout(() => { setClockNow(Date.now()); }, wait + 25);
    return () => { window.clearTimeout(id); };
  }, [retrySource, setClockNow]);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, dashboard);
  const connect = useSumitConnect({
    companyId,
    apiKey,
    setApiKey,
    onSuccess: () => {
      setConnectSheet(false);
    },
  });
  const mercuryConnect = useMercuryConnect({
    apiKey: mercuryApiKey,
    setApiKey: setMercuryApiKey,
    onSuccess: () => {
      setMercuryConnectSheet(false);
    },
  });
  const refresh = useWrite({
    failure: (error) => hebrewSumitError(error.message) ?? "הרענון נכשל.",
    silent: (error) => error.message === "sync_held",
    success: REFRESH_DONE,
    keys: SUMIT_REFRESH_KEYS,
    run: async () => {
      const data = await invokeEdge("sumit-sync", { force: true });
      if (data != null && typeof data === "object" && "skipped" in data && data.skipped === true) {
        // Another tab or an earlier load holds the claim: show it as syncing, without a skip toast.
        await queryClient.refetchQueries({ queryKey: ["sumit"] });
        const held = queryClient.getQueriesData<{ syncing?: boolean }>({ queryKey: ["sumit"] }).some(([, d]) => d?.syncing === true);
        throw new Error(held ? "sync_held" : "sync_skipped");
      }
    },
  });
  const disconnect = useWrite({
    failure: "לא הצלחנו לנתק.",
    success: "החיבור נותק. הספרים נשארו.",
    keys: ["sumit"],
    onSuccess: () => {
      setDisconnectOpen(false);
      setStatusOpen(false);
      setConnectOpen(false);
      popSheetLayers(navigate, 2);
      setFocusSumit(true);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("disconnect_sumit"));
    },
  });
  const mercuryRefresh = useWrite({
    failure: (error) => hebrewMercuryError(error.message) ?? "הרענון נכשל.",
    silent: (error) => error.message === "sync_held",
    success: REFRESH_DONE,
    keys: MERCURY_REFRESH_KEYS,
    run: async () => {
      const data = await invokeEdge("mercury-sync", { force: true });
      if (data != null && typeof data === "object" && "skipped" in data && data.skipped === true) {
        await queryClient.refetchQueries({ queryKey: ["mercury"] });
        const held = queryClient.getQueriesData<{ syncing?: boolean }>({ queryKey: ["mercury"] }).some(([, d]) => d?.syncing === true);
        throw new Error(held ? "sync_held" : "sync_skipped");
      }
    },
  });
  // syncing comes from the server claim, so the busy row survives a reload, a new tab, and reopening the app.
  const sumitSyncing = status.data?.syncing === true;
  const mercurySyncing = mercuryStatus.data?.syncing === true;
  const sumitRefreshBusy = refresh.isPending || sumitSyncing;
  const mercuryRefreshBusy = mercuryRefresh.isPending || mercurySyncing;
  useSyncSettled({
    syncing: sumitSyncing,
    pending: refresh.isPending,
    lastSyncAt: status.data?.last_sync_at,
    lastError: status.data?.last_error,
    keys: SUMIT_REFRESH_KEYS,
    success: REFRESH_DONE,
  });
  useSyncSettled({
    syncing: mercurySyncing,
    pending: mercuryRefresh.isPending,
    lastSyncAt: mercuryStatus.data?.last_sync_at,
    lastError: mercuryStatus.data?.last_error,
    keys: MERCURY_REFRESH_KEYS,
    success: REFRESH_DONE,
  });
  const mercuryDisconnect = useWrite({
    failure: "לא הצלחנו לנתק.",
    success: "החיבור נותק. הספרים נשארו.",
    keys: ["mercury"],
    onSuccess: () => {
      setMercuryDisconnectOpen(false);
      setMercuryStatusOpen(false);
      setMercuryConnectOpen(false);
      popSheetLayers(navigate, 2);
      setFocusMercury(true);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("disconnect_connector", { p_provider: "mercury" }));
    },
  });

  useEffect(() => {
    if (sumitNonce === 0) return;
    setSumitHint("");
    const id = window.setTimeout(() => {
      setSumitHint("לא הצלחנו לטעון");
      const retry = sumitRetryRef.current;
      const active = document.activeElement;
      if (retry == null || active === retry) return;
      if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement) return;
      retry.focus();
    }, 30);
    return () => { window.clearTimeout(id); };
  }, [sumitNonce]);

  useEffect(() => {
    if (mercuryNonce === 0) return;
    setMercuryHint("");
    const id = window.setTimeout(() => {
      setMercuryHint("לא הצלחנו לטעון");
      const retry = mercuryRetryRef.current;
      const active = document.activeElement;
      if (retry == null || active === retry) return;
      if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement) return;
      retry.focus();
    }, 30);
    return () => { window.clearTimeout(id); };
  }, [mercuryNonce]);

  const sumitNoCompany = sample
    ? sample.noCompany === true
    : previewValue === "empty" || (preview === "off" && dashboard.data?.company_id == null);
  const sumitPaused = sample == null && preview === "off" && !sumitNoCompany && status.fetchStatus === "paused" && status.data == null;
  const sumitShowsRetry = sample?.sumit === "error" || (
    sample == null
    && !sumitNoCompany
    && (sumitRetrying || sumitPaused || (status.isError && status.data == null))
  );
  const sumitRowReady = phase.kind !== "loading"
    && phase.kind !== "error"
    && sample?.sumit !== "loading"
    && sample?.sumit !== "error"
    && !sumitShowsRetry
    && !(sample == null && !sumitNoCompany && status.isLoading && !sumitRetrying);
  useFocusRowAfterRetry(sumitShowsRetry, sumitRetryRef, sumitRowRef, sumitRowReady, sumitNonce);

  const mercuryPaused = sample == null && preview === "off" && !sumitNoCompany && mercuryStatus.fetchStatus === "paused" && mercuryStatus.data == null;
  const mercuryShowsRetry = sample?.mercury === "error" || (
    sample == null
    && !sumitNoCompany
    && (mercuryRetrying || mercuryPaused || (mercuryStatus.isError && mercuryStatus.data == null))
  );
  const mercuryRowReady = phase.kind !== "loading"
    && phase.kind !== "error"
    && sample?.mercury !== "loading"
    && sample?.mercury !== "error"
    && !mercuryShowsRetry
    && !(sample == null && !sumitNoCompany && mercuryStatus.isLoading && !mercuryRetrying);
  useFocusRowAfterRetry(mercuryShowsRetry, mercuryRetryRef, mercuryRowRef, mercuryRowReady, mercuryNonce);

  useEffect(() => onlineManager.subscribe((online) => {
    if (online) {
      setSumitOffline(0);
      setMercuryOffline(0);
    }
  }), []);

  useEffect(() => {
    if (!focusSumit) return;
    if (sumitRowRef.current == null) return;
    const id = window.setTimeout(() => {
      sumitRowRef.current?.focus();
      setFocusSumit(false);
    }, 0);
    return () => { window.clearTimeout(id); };
  }, [focusSumit, status.data, status.isError, status.isLoading]);

  useEffect(() => {
    if (!focusMercury) return;
    if (mercuryRowRef.current == null) return;
    const id = window.setTimeout(() => {
      mercuryRowRef.current?.focus();
      setFocusMercury(false);
    }, 0);
    return () => { window.clearTimeout(id); };
  }, [focusMercury, mercuryStatus.data, mercuryStatus.isError, mercuryStatus.isLoading]);

  useEffect(() => {
    if (holdWrites) return;
    if (sheetApplied.current) return;
    const noCo = sample
      ? sample.noCompany === true
      : previewValue === "empty" || (preview === "off" && dashboard.data?.company_id == null);
    const asked = params.get("sheet");
    if (asked === "sumit" || asked === "mercury") {
      if (phase.kind === "loading" || phase.kind === "error") {
        adoptSheet.current = false;
        return;
      }
      if (sample == null && !noCo && (asked === "sumit" ? status.isLoading : mercuryStatus.isLoading)) {
        adoptSheet.current = false;
        return;
      }
      const companySettling = sample == null && preview === "off" && dashboard.isFetching && dashboard.data?.company_id == null;
      if (companySettling) {
        adoptSheet.current = false;
        return;
      }
      wantSheet.current = asked;
      const next = new URLSearchParams(params);
      next.delete("sheet");
      setParams(next, { replace: true });
      return;
    }
    const wanted = wantSheet.current;
    if (wanted == null) return;
    const mercury = wanted === "mercury";
    const query = mercury ? mercuryStatus : status;
    const auth = mercury
      ? (sample ? sample.mercuryLastError : mercuryStatus.data?.last_error) === "auth"
      : (sample ? sample.lastError : status.data?.last_error) === "sumit_auth";
    const isConnected = noCo
      ? false
      : mercury
        ? (sample ? sample.mercuryConnected === true : mercuryStatus.data?.connected === true)
        : (sample ? sample.connected : status.data?.connected === true);
    const statusPaused = sample == null && preview === "off" && !noCo && query.fetchStatus === "paused" && query.data == null;
    const opened = sumitKind({
      forced: (mercury ? sample?.mercury : sample?.sumit) ?? null,
      noCompany: noCo,
      statusLoading: false,
      statusFailed: sample == null && (statusPaused || (query.isError && query.data == null)),
      authReconnect: auth,
      connected: isConnected,
    });
    sheetApplied.current = true;
    wantSheet.current = null;
    if (opened === "connected" || opened === "reconnect" || opened === "disconnected") {
      const earlier = historyIndex();
      adoptSheet.current = earlier != null && earlier > 0;
    }
    if (mercury) {
      if (opened === "connected") setMercuryStatusOpen(true);
      else if (opened === "reconnect" || opened === "disconnected") setMercuryConnectOpen(true);
      return;
    }
    if (opened === "connected") setStatusOpen(true);
    else if (opened === "reconnect" || opened === "disconnected") setConnectOpen(true);
  }, [params, setParams, phase.kind, sample, preview, previewValue, dashboard.data, dashboard.isFetching, status, mercuryStatus, holdWrites]);

  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="חיבורים"
        kicker="הגדרות"
        backTo={`/settings${search}`}
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
      />
    );
  }

  const noCompany = sample
    ? sample.noCompany === true
    : previewValue === "empty" || (preview === "off" && dashboard.data?.company_id == null);
  const connected = noCompany ? false : sample ? sample.connected : status.data?.connected === true;
  const sumitId = sample ? sample.companyId : status.data?.sumit_company_id;
  const rawError = sample ? sample.lastError : status.data?.last_error;
  const lastError = hebrewSumitError(rawError);
  const authReconnect = rawError === "sumit_auth";
  const retry = authReconnect ? null : retryClockParts(retrySource, clockNow);
  const refreshHeld = retry != null;
  const statusPaused = sample == null && preview === "off" && !noCompany && status.fetchStatus === "paused" && status.data == null;
  const kind = sumitKind({
    forced: sample?.sumit ?? null,
    noCompany,
    statusLoading: sample == null && !noCompany && status.isLoading && !sumitRetrying,
    statusFailed: sample == null && (sumitRetrying || statusPaused || (status.isError && status.data == null)),
    authReconnect,
    connected,
  });
  const syncPhrase = israelSyncPhrase(sample ? sample.lastSyncAt : status.data?.last_sync_at, clockNow);
  const mercuryConnected = noCompany ? false : sample ? sample.mercuryConnected === true : mercuryStatus.data?.connected === true;
  const mercuryRawError = sample ? sample.mercuryLastError : mercuryStatus.data?.last_error;
  const mercuryLastError = hebrewMercuryError(mercuryRawError);
  const mercuryAuthReconnect = mercuryRawError === "auth";
  const mercuryRetrySource = sample ? undefined : mercuryStatus.data?.next_attempt_at;
  const mercuryRetry = mercuryAuthReconnect ? null : retryClockParts(mercuryRetrySource, clockNow);
  const mercuryRefreshHeld = mercuryRetry != null;
  const mercuryStatusPaused = sample == null && preview === "off" && !noCompany && mercuryStatus.fetchStatus === "paused" && mercuryStatus.data == null;
  const mercuryKind = sumitKind({
    forced: sample?.mercury ?? null,
    noCompany,
    statusLoading: sample == null && !noCompany && mercuryStatus.isLoading && !mercuryRetrying,
    statusFailed: sample == null && (mercuryRetrying || mercuryStatusPaused || (mercuryStatus.isError && mercuryStatus.data == null)),
    authReconnect: mercuryAuthReconnect,
    connected: mercuryConnected,
  });
  const mercurySyncPhrase = israelSyncPhrase(sample ? sample.mercuryLastSyncAt : mercuryStatus.data?.last_sync_at, clockNow);
  const retryHint = retry == null ? undefined : (
    <>
      {retry.tomorrow ? "אפשר לנסות שוב מחר ב-" : "אפשר לנסות שוב ב-"}
      <bdi className="ui-num" dir="ltr">{retry.clock}</bdi>
    </>
  );
  const refreshHint = retryHint;
  const mercuryRetryHint = mercuryRetry == null ? undefined : (
    <>
      {mercuryRetry.tomorrow ? "אפשר לנסות שוב מחר ב-" : "אפשר לנסות שוב ב-"}
      <bdi className="ui-num" dir="ltr">{mercuryRetry.clock}</bdi>
    </>
  );
  const mercuryRefreshHint = mercuryRetryHint;
  return (
    <ViewerScope>
    <div>
      <ScreenHeader title="חיבורים" kicker="הגדרות" backTo={`/settings${search}`} />
      <ViewerNote />
      <SectionHead title="ספרים ובנק" />
      {kind === "loading" || mercuryKind === "loading" ? <p className="sr-only" role="status">טוען…</p> : null}
      <List>
        <ConnectorRow
          title="SUMIT"
          icon={<DocumentIcon size={24} />}
          state={kind === "loading" ? "loading" : kind === "error" ? "error" : "ready"}
          hint={connectorWord(kind)}
          warning={kind === "reconnect"}
          rowRef={sumitRowRef}
          onOpen={holdWrites ? undefined : () => {
            if (kind === "connected") setStatusSheet(true);
            else setConnectSheet(true);
          }}
          retry={{
            hint: (
              <>
                {sumitHint}
                {sumitOffline > 0 ? <span className="sr-only">אין חיבור לאינטרנט</span> : null}
              </>
            ),
            label: "ניסיון חוזר: SUMIT",
            busy: sumitRetrying,
            retryRef: sumitRetryRef,
            onRetry: () => {
              if (sample != null || sumitRetrying) return;
              if (!onlineManager.isOnline()) {
                setSumitOffline((nonce) => nonce + 1);
                return;
              }
              setSumitRetrying(true);
              void status.refetch().then((result) => {
                const stayed = document.activeElement === sumitRetryRef.current;
                setSumitRetrying(false);
                if (result.fetchStatus === "paused" || !onlineManager.isOnline()) {
                  setSumitOffline((nonce) => nonce + 1);
                  return;
                }
                if (result.isError || result.data == null) {
                  setSumitNonce((nonce) => nonce + 1);
                  return;
                }
                if (stayed) setFocusSumit(true);
              });
            },
          }}
        />
        <ConnectorRow
          title="Mercury"
          icon={<BankIcon size={24} />}
          state={mercuryKind === "loading" ? "loading" : mercuryKind === "error" ? "error" : "ready"}
          hint={connectorWord(mercuryKind)}
          warning={mercuryKind === "reconnect"}
          rowRef={mercuryRowRef}
          onOpen={holdWrites ? undefined : () => {
            if (mercuryKind === "connected") setMercuryStatusSheet(true);
            else setMercuryConnectSheet(true);
          }}
          retry={{
            hint: (
              <>
                {mercuryHint}
                {mercuryOffline > 0 ? <span className="sr-only">אין חיבור לאינטרנט</span> : null}
              </>
            ),
            label: "ניסיון חוזר: Mercury",
            busy: mercuryRetrying,
            retryRef: mercuryRetryRef,
            onRetry: () => {
              if (sample != null || mercuryRetrying) return;
              if (!onlineManager.isOnline()) {
                setMercuryOffline((nonce) => nonce + 1);
                return;
              }
              setMercuryRetrying(true);
              void mercuryStatus.refetch().then((result) => {
                const stayed = document.activeElement === mercuryRetryRef.current;
                setMercuryRetrying(false);
                if (result.fetchStatus === "paused" || !onlineManager.isOnline()) {
                  setMercuryOffline((nonce) => nonce + 1);
                  return;
                }
                if (result.isError || result.data == null) {
                  setMercuryNonce((nonce) => nonce + 1);
                  return;
                }
                if (stayed) setFocusMercury(true);
              });
            },
          }}
        />
      </List>
      <SectionHead title="עזרים" />
      <JevSettings
        noCompany={noCompany}
        blocked={blocked}
        readOnly={holdWrites}
        sample={
          noCompany
            ? undefined
            : sample
              ? (sample.jev ?? JEV_DEFAULT)
              : preview !== "off"
                ? JEV_DEFAULT
                : undefined
        }
      />
      <AssistantSettings
        announceLoading={kind !== "loading"}
        sample={
          // A missing company, and any preview, must not call flow-mcp/status.
          sample
            ? (noCompany ? { state: "no-company" } : (sample.assistant ?? { state: "empty" }))
            : noCompany
              ? { state: "no-company" }
              : preview !== "off"
                ? { state: "empty" }
                : undefined
        }
        noCompany={noCompany}
        blocked={import.meta.env.DEV && params.get("e2e") === "stack" ? undefined : blocked}
        sampleSecret={import.meta.env.DEV && params.get("e2e") === "stack" ? sampleSecret : undefined}
        showHeading={false}
        initialOpen={params.get("sheet") === "assistant"}
        readOnly={holdWrites}
        viewerCopy={viewer}
      />
      <SumitConnectSheet
        open={connectOpen}
        onOpenChange={setConnectSheet}
        title={authReconnect && !noCompany ? "SUMIT" : "חיבור SUMIT"}
        returnFocusRef={sumitRowRef}
        noCompanyBody={noCompany ? (
          <div className="ui-stack">
            <p>כדי לחבר את SUMIT צריך עסק.</p>
            <TextLink to={onboardingFromSettings(search)} replace={sheetStack(location.state).includes("sumit-connect")}>פרטי העסק</TextLink>
          </div>
        ) : undefined}
        authReconnect={authReconnect}
        companyId={companyId}
        setCompanyId={setCompanyId}
        apiKey={apiKey}
        setApiKey={setApiKey}
        submitLabel={authReconnect ? "חיבור מחדש" : "חיבור"}
        busy={connect.isPending}
        disabled={holdWrites}
        onSubmit={() => {
          if (holdWrites || blocked()) return;
          connect.mutate();
        }}
        onDisconnect={authReconnect ? () => {
          if (holdWrites) return;
          setDisconnectSheet(true);
        } : undefined}
        disconnectRef={sumitDisconnectRef}
      />
      <Sheet open={statusOpen} onOpenChange={setStatusSheet} title="SUMIT" returnFocusRef={sumitRowRef}>
        <div className="ui-stack">
          <p>
            מחובר
            {sumitId != null ? <span className="ui-nowrap">{` · מספר חברה `}<bdi dir="ltr">{String(sumitId)}</bdi></span> : null}
            {syncPhrase != null ? <span className="ui-nowrap">{` · ${syncPhrase}`}</span> : null}
          </p>
          {refreshHeld && rawError != null && rawError !== "sumit_auth" ? <p>הרענון נכשל</p> : null}
          {!refreshHeld && rawError != null && rawError !== "sumit_auth" && lastError ? <p>{lastError}</p> : null}
        </div>
        <List>
          <ListRow
            variant="button"
            title={sumitRefreshBusy ? "מרענן…" : "רענון עכשיו"}
            hint={refreshHint}
            icon={<RefreshIcon />}
            chevron
            clearHint={retry != null}
            describeHint={refreshHint != null}
            wrapHint
            busy={sumitRefreshBusy}
            disabled={refreshHeld}
            onClick={() => {
              if (holdWrites || refreshHeld || sumitRefreshBusy) return;
              if (blocked()) return;
              refresh.mutate();
            }}
          />
          <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} buttonRef={sumitDisconnectRef} onClick={() => { if (holdWrites) return; setDisconnectSheet(true); }} />
        </List>
      </Sheet>
      <ConfirmSheet
        open={disconnectOpen}
        onOpenChange={setDisconnectSheet}
        returnFocusRef={sumitDisconnectRef}
        title="לנתק את SUMIT?"
        consequence="המפתח נמחק. הספרים שכבר ירדו נשארים."
        confirmLabel="ניתוק"
        destructive
        busy={disconnect.isPending}
        onConfirm={() => {
          if (holdWrites || blocked()) return;
          disconnect.mutate();
        }}
      />
      <MercuryConnectSheet
        open={mercuryConnectOpen}
        onOpenChange={setMercuryConnectSheet}
        title={mercuryAuthReconnect && !noCompany ? "צריך לחבר מחדש את Mercury" : "חיבור Mercury"}
        returnFocusRef={mercuryRowRef}
        noCompanyBody={noCompany ? (
          <div className="ui-stack">
            <p>כדי לחבר את Mercury צריך עסק.</p>
            <TextLink to={onboardingFromSettings(search)} replace={sheetStack(location.state).includes("mercury-connect")}>פרטי העסק</TextLink>
          </div>
        ) : undefined}
        authReconnect={mercuryAuthReconnect}
        apiKey={mercuryApiKey}
        setApiKey={setMercuryApiKey}
        submitLabel={mercuryAuthReconnect ? "חיבור מחדש" : "חיבור"}
        busy={mercuryConnect.isPending}
        disabled={holdWrites}
        onSubmit={() => {
          if (holdWrites || blocked()) return;
          mercuryConnect.mutate();
        }}
        onDisconnect={mercuryAuthReconnect ? () => {
          if (holdWrites) return;
          setMercuryDisconnectSheet(true);
        } : undefined}
        disconnectRef={mercuryDisconnectRef}
      />
      <Sheet open={mercuryStatusOpen} onOpenChange={setMercuryStatusSheet} title="Mercury" returnFocusRef={mercuryRowRef}>
        <div className="ui-stack">
          <p>
            מחובר
            {mercurySyncPhrase != null ? <span className="ui-nowrap">{` · ${mercurySyncPhrase}`}</span> : null}
          </p>
          {mercuryRefreshHeld && mercuryRawError != null && mercuryRawError !== "auth" ? <p>הרענון נכשל</p> : null}
          {!mercuryRefreshHeld && mercuryRawError != null && mercuryRawError !== "auth" && mercuryLastError ? <p>{mercuryLastError}</p> : null}
        </div>
        <List>
          <ListRow
            variant="button"
            title={mercuryRefreshBusy ? "מרענן…" : "רענון עכשיו"}
            hint={mercuryRefreshHint}
            icon={<RefreshIcon />}
            chevron
            clearHint={mercuryRetry != null}
            describeHint={mercuryRefreshHint != null}
            wrapHint
            busy={mercuryRefreshBusy}
            disabled={mercuryRefreshHeld}
            onClick={() => {
              if (holdWrites || mercuryRefreshHeld || mercuryRefreshBusy) return;
              if (blocked()) return;
              mercuryRefresh.mutate();
            }}
          />
          <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} buttonRef={mercuryDisconnectRef} onClick={() => { if (holdWrites) return; setMercuryDisconnectSheet(true); }} />
        </List>
      </Sheet>
      <ConfirmSheet
        open={mercuryDisconnectOpen}
        onOpenChange={setMercuryDisconnectSheet}
        returnFocusRef={mercuryDisconnectRef}
        title="לנתק את Mercury?"
        consequence="המפתח נמחק. הספרים שכבר ירדו נשארים."
        confirmLabel="ניתוק"
        destructive
        busy={mercuryDisconnect.isPending}
        onConfirm={() => {
          if (holdWrites || blocked()) return;
          mercuryDisconnect.mutate();
        }}
      />
    </div>
    </ViewerScope>
  );
}

const KEPT_OUT = "מחוץ לרווח והפסד";
const KEPT_OUT_SHORT = "מחוץ לרווח";

/** The three loan categories the server keeps fixed, by `loan_part`, and whether each counts in the P&L (decision 0099). */
const LOAN_CATEGORY_LINES: Record<string, string> = {
  interest: "חלק מתשלום הלוואה · תמיד ברווח והפסד",
  escrow: "חלק מתשלום הלוואה · תמיד ברווח והפסד",
  principal: "קטגוריית הלוואה · תמיד מחוץ לרווח והפסד",
};

function loanCategoryLine(category: CategoryRow): string | null {
  return category.loan_part ? (LOAN_CATEGORY_LINES[category.loan_part] ?? null) : null;
}

type PnlChange = { id: string; name: string; excluded: boolean; undo: boolean };

function CategoryLine({
  category,
  muted = false,
  plain = false,
  onMenu,
}: {
  category: CategoryRow & { count?: number };
  muted?: boolean;
  /** A viewer row keeps the height and drops the pointer. */
  plain?: boolean;
  onMenu?: (opener: HTMLElement) => void;
}) {
  return (
    <ListRow
      variant="item"
      plain={plain}
      title={category.name}
      muted={muted}
      meta={category.count == null ? undefined : category.count === 1 ? "תנועה אחת" : `${String(category.count)} תנועות`}
      tag={category.excluded_from_pnl === true ? (
        <span className="ui-cat-out" role="img" aria-label={KEPT_OUT}>
          <KeptOutIcon size={18} />
        </span>
      ) : undefined}
      action={onMenu == null ? undefined : (
        <IconButton
          label={`עוד, ${category.name}`}
          onClick={(event) => { onMenu(event.currentTarget); }}
        >
          <MoreIcon />
        </IconButton>
      )}
    />
  );
}

export function CategoriesScreen({
  sample,
  hiddenOpen = false,
}: {
  sample?: Array<CategoryRow & { count?: number }>;
  /** Stories open the hidden list without a click. */
  hiddenOpen?: boolean;
} = {}) {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const [params] = useSearchParams();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const categories = useCategoriesQuery(sample == null);
  const dashboard = useDashboardQuery(sample == null && preview === "off");
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, categories);
  const rows: Array<CategoryRow & { count?: number }> = sample ?? categories.data ?? [];
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [showHidden, setShowHidden] = useState(hiddenOpen);
  const [menu, setMenu] = useState<(CategoryRow & { count?: number }) | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [hideTarget, setHideTarget] = useState<CategoryRow | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const toast = useToast();
  const menuOpener = useRef<HTMLElement | null>(null);
  const pnlHintId = useId();
  const pnl = useWrite<PnlChange>({
    failure: "לא הצלחנו לעדכן את הקטגוריה.",
    keys: ["categories", "dashboard", "project", "project-category"],
    onSuccess: (done) => {
      setMenu(null);
      toast.show({
        message: `${done.name} · ${done.excluded ? KEPT_OUT : "ברווח והפסד"}`,
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => { pnl.mutate({ ...done, excluded: !done.excluded, undo: true }); },
        }),
      });
    },
    run: async (change) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_category_excluded_from_pnl", { p_id: change.id, p_excluded: change.excluded }));
    },
  });
  const createCategory = useWrite({
    failure: (error) => (error.message.includes("already") ? "יש כבר קטגוריה בשם הזה." : "לא הצלחנו ליצור את הקטגוריה."),
    success: "הקטגוריה נשמרה",
    keys: ["categories"],
    onSuccess: () => {
      setCreateOpen(false);
      setCategoryName("");
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("create_category", { p_name: categoryName, p_kind: kind }));
    },
  });
  const hide = useWrite({
    failure: "לא הצלחנו לעדכן את הקטגוריה.",
    keys: ["categories"],
    onSuccess: () => { setHideTarget(null); },
    run: async () => {
      if (!hideTarget) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_category_hidden", { p_id: hideTarget.id, p_hidden: !hideTarget.hidden }));
    },
  });
  const merge = useWrite({
    failure: "לא הצלחנו למזג.",
    success: "הקטגוריות מוזגו",
    keys: ["categories", "dashboard"],
    onSuccess: () => { setMergeOpen(false); },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("merge_category", { p_from: mergeFrom, p_into: mergeInto }));
    },
  });
  const fromName = rows.find((category) => category.id === mergeFrom)?.name ?? "";
  const intoName = rows.find((category) => category.id === mergeInto)?.name ?? "";
  const shown = rows.filter((category) => category.kind === kind && !category.hidden);
  const hiddenRows = rows.filter((category) => category.kind === kind && category.hidden);
  const hiddenExpanded = showHidden && hiddenRows.length > 0;
  const anyKeptOut = rows.some((category) => category.kind === kind && category.excluded_from_pnl === true);
  const menuLoanLine = menu ? loanCategoryLine(menu) : null;
  const menuKeptOut = menu?.excluded_from_pnl === true;
  const mergeTargets = rows.filter((category) => category.id !== mergeFrom && category.kind === kind && !category.hidden);
  const previewNoCompany = sample == null && params.get("preview") === "empty";
  const liveNoCompany = sample == null && preview === "off" && dashboard.isSuccess && dashboard.data.company_id == null;
  if (previewNoCompany || liveNoCompany) {
    return <Navigate to={`/settings${search}`} replace />;
  }
  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="קטגוריות"
        kicker="הגדרות"
        backTo={`/settings${search}`}
        phase={phase}
        onRetry={() => { void categories.refetch(); }}
      />
    );
  }
  return (
    <div>
      <ScreenHeader title="קטגוריות" kicker="הגדרות" backTo={`/settings${search}`} />
      <div className="ui-page-pad ui-cat-seg">
        <SegmentedControl
          label="סוג"
          showLabel={false}
          radius="input"
          value={kind}
          onChange={(next) => {
            setKind(next);
            setShowHidden(false);
          }}
          options={[
            { value: "expense", label: "הוצאות" },
            { value: "income", label: "הכנסות" },
          ]}
        />
      </div>
      {shown.length === 0 && hiddenRows.length === 0 ? (
        <EmptyState icon={<TagIcon />} title="אין עדיין קטגוריות" body="קטגוריות נוצרות מהמסמכים של SUMIT או כשמוסיפים אחת" />
      ) : shown.length > 0 ? (
      <List className="ui-cat-list">
        {shown.map((category) => (
          <CategoryLine
            key={category.id}
            category={category}
            plain={holdWrites}
            onMenu={holdWrites ? undefined : (opener) => {
              menuOpener.current = opener;
              setMenu(category);
            }}
          />
        ))}
      </List>
      ) : null}
      <div className="ui-cat-foot">
        {holdWrites ? null : (
        <TextLink
          chevron={false}
          wrap
          icon={<PlusIcon size={16} stroke={2.2} />}
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          קטגוריה חדשה
        </TextLink>
        )}
        {hiddenRows.length > 0 ? (
          <TextLink
            tone="quiet"
            chevron={false}
            wrap
            className="ui-cat-foot-end"
            expanded={hiddenExpanded}
            controls="categories-hidden"
            trailing={<ChevronDownIcon size={16} />}
            onClick={() => {
              setShowHidden((current) => !current);
            }}
          >
            מוסתרות · <bdi className="ui-num">{String(hiddenRows.length)}</bdi>
          </TextLink>
        ) : null}
      </div>
      {hiddenRows.length > 0 ? (
        <div id="categories-hidden" hidden={!hiddenExpanded}>
          {hiddenExpanded ? (
            <List className="ui-cat-list ui-cat-hidden">
              {hiddenRows.map((category) => (
                <CategoryLine
                  key={category.id}
                  category={category}
                  muted
                  plain={holdWrites}
                  onMenu={holdWrites ? undefined : (opener) => {
                    menuOpener.current = opener;
                    setMenu(category);
                  }}
                />
              ))}
            </List>
          ) : null}
        </div>
      ) : null}
      {anyKeptOut ? (
        <p className="t-hint ui-page-pad ui-cat-legend">
          <KeptOutIcon size={14} />
          {KEPT_OUT}
        </p>
      ) : null}
      <Sheet
        open={menu != null}
        onOpenChange={(open) => {
          // A dismiss during the P&L write waits for it: success closes the sheet, failure keeps it.
          if (open) return true;
          if (pnl.isPending) return false;
          setMenu(null);
          return true;
        }}
        title={menu?.name ?? "קטגוריה"}
        returnFocusRef={menuOpener}
      >
        <div className="ui-stack">
          <Button
            variant="secondary"
            disabled={pnl.isPending}
            onClick={() => {
              setHideTarget(menu);
              setMenu(null);
            }}
          >
            {menu?.hidden ? "החזרה לרשימה" : "הסתרה"}
          </Button>
          <Button
            variant="secondary"
            disabled={pnl.isPending}
            onClick={() => {
              setMergeFrom(menu?.id ?? "");
              setMenu(null);
              setPickOpen(true);
            }}
          >
            מיזוג
          </Button>
          {menuLoanLine != null ? (
            <p className="ui-cat-fixed">
              <LockIcon size={18} />
              {menuLoanLine}
            </p>
          ) : menu != null ? (
            <>
              <Button
                variant="secondary"
                busy={pnl.isPending}
                aria-describedby={pnlHintId}
                onClick={() => {
                  if (pnl.isPending || blocked()) return;
                  pnl.mutate({ id: menu.id, name: menu.name, excluded: !menuKeptOut, undo: false });
                }}
              >
                {pnl.isPending ? "מעדכן…" : menuKeptOut ? "החזרה לרווח והפסד" : KEPT_OUT}
              </Button>
              <p id={pnlHintId} className="t-hint ui-cat-pnl-hint">
                {menuKeptOut ? "הסכומים ייספרו שוב כהכנסה או הוצאה." : "הכסף נשאר בתזרים, ולא נספר כהכנסה או הוצאה."}
              </p>
            </>
          ) : null}
        </div>
      </Sheet>
      <Sheet open={pickOpen} onOpenChange={setPickOpen} title="מיזוג אל">
        <div className="ui-stack">
          {mergeTargets.map((category) => (
            <Button
              key={category.id}
              variant="secondary"
              onClick={() => {
                setMergeInto(category.id);
                setPickOpen(false);
                setMergeOpen(true);
              }}
            >
              {category.name}
            </Button>
          ))}
        </div>
      </Sheet>
      <Sheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="קטגוריה חדשה"
        action={
          <Button
            busy={createCategory.isPending}
            onClick={() => {
              if (blocked()) return;
              createCategory.mutate();
            }}
          >
            שמירה
          </Button>
        }
      >
        <TextField label="שם" value={categoryName} onChange={(event) => { setCategoryName(event.target.value); }} />
      </Sheet>
      <ConfirmSheet
        open={hideTarget != null}
        onOpenChange={(open) => { if (!open) setHideTarget(null); }}
        title={hideTarget?.hidden ? "להחזיר את הקטגוריה לרשימה?" : "להסתיר את הקטגוריה?"}
        item={hideTarget?.name}
        consequence={hideTarget?.hidden ? "הקטגוריה תופיע שוב ברשימה." : "הקטגוריה לא נמחקת. אפשר להחזיר אותה מ״מוסתרות״."}
        confirmLabel={hideTarget?.hidden ? "החזרה לרשימה" : "הסתרה"}
        destructive={hideTarget?.hidden !== true}
        busy={hide.isPending}
        onConfirm={() => {
          if (blocked()) return;
          hide.mutate();
        }}
      />
      <ConfirmSheet
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        title="למזג את הקטגוריה?"
        item={`${fromName} ← ${intoName}`}
        consequence="התנועות עוברות אל היעד. אי אפשר להפריד אחר כך."
        confirmLabel="מיזוג"
        destructive
        busy={merge.isPending}
        onConfirm={() => {
          if (blocked()) return;
          merge.mutate();
        }}
      />
    </div>
  );
}

export function NotificationsScreen() {
  const search = usePreviewSearch();
  return (
    <div>
      <ScreenHeader title="התראות" backTo={`/settings${search}`} />
      {/* FLOW-328: the shared empty state, Hebrew only. */}
      <EmptyState icon={<BellIcon />} title="אין עדיין התראות" body="בשלב הזה ההודעות לא נשלחות." />
    </div>
  );
}

function combinePhase(left: ScreenPhase, right: ScreenPhase): ScreenPhase {
  if (left.kind === "error") return left;
  if (right.kind === "error") return right;
  if (left.kind === "loading" || right.kind === "loading") return { kind: "loading" };
  if (left.kind === "empty" || right.kind === "empty") return { kind: "empty" };
  return { kind: "ready" };
}
