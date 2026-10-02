import { formatIls, shekelsToAgorot, type CategoryRow, type Dashboard, type FiledTodayRow, type ProjectDetail, type ProjectWaitingRow, type ReviewRow, type TransactionDetail, type UnpaidRow } from "@flow/shared";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { overheadHint, shownProfit } from "../overhead";
import { useAuth } from "../auth";
import { addTriggerRef } from "../add-trigger";
import { getSupabase } from "../lib/supabase";
import { periodLabel } from "../period";
import { useFlowSearch, useHomePreview, usePreviewSearch, type HomePreview } from "../preview";
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
import { hebrewSumitError, retryClockParts } from "../sumit-copy";
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
  useSumitStatusQuery,
  useTransactionQuery,
  useUnpaidQuery,
} from "../use-books";
import { assertNoError, useWrite } from "../use-write";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonReader(value: unknown): value is { json: () => Promise<unknown> } {
  return isRecord(value) && typeof value.json === "function";
}

async function edgeErrorCode(error: unknown): Promise<string> {
  if (!(error instanceof FunctionsHttpError)) return "connect_failed";
  const context: unknown = Reflect.get(error, "context");
  if (!isJsonReader(context)) return "connect_failed";
  try {
    const payload: unknown = await context.json();
    if (isRecord(payload) && typeof payload.error === "string") return payload.error;
  } catch {
    return "connect_failed";
  }
  return "connect_failed";
}

async function invokeEdge(name: "sumit-connect" | "sumit-sync", body: Record<string, unknown>): Promise<unknown> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke<unknown>(name, { body });
  if (response.error) throw new Error(await edgeErrorCode(response.error));
  return response.data;
}
import { AssistantSettings, type AssistantSample } from "./assistant-settings";
import { Banner } from "../ui/banner";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { CheckRow } from "../ui/check-row";
import { StatusPill } from "../ui/chip";
import { formatDayMonth, formatDisplay, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { HoldLine } from "../ui/hold-line";
import { BackButton, transactionParent, useGoBack, useSheetHistory } from "../ui/back";
import { IconButton } from "../ui/icon-button";
import { CameraIcon, CheckIcon, ChevronDownIcon, CloseIcon, DocumentIcon, DownloadIcon, GoogleIcon, LogoutIcon, MoreIcon, PencilIcon, PlusIcon, ProjectsIcon, RefreshIcon, ReviewIcon, SearchIcon, SplitIcon, TagIcon, TrashIcon } from "../ui/icons";
import { BandFigures, BandHero, FormError, SectionHead, SharedCostNote } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { CHANGE_SAVE_FAILURE, ChangeAssignment, changeSaveFailure, COLLAPSE_PICK_HOLD, COLLAPSE_SPLIT_NOTE, ONE_PROJECT_DETAIL, ONE_PROJECT_OPTION, type ChangeChoice } from "../ui/change-sheet";
import { FocusTitle } from "../ui/focus-title";
import { MoneyField, PercentField } from "../ui/money-field";
import { BudgetBar, ProgressBar } from "../ui/progress-bar";
import { RadioRow } from "../ui/radio-row";
import { ReviewCard } from "../ui/review-card";
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

export function OnboardingScreen() {
  const navigate = useNavigate();
  const search = usePreviewSearch();
  const blocked = useBlockedPreview();
  const [name, setName] = useState("");
  const [vat, setVat] = useState<"registered" | "exempt">("registered");
  const save = useWrite({
    failure: "לא הצלחנו לשמור.",
    keys: ["home", "dashboard"],
    onSuccess: () => {
      void navigate("/", { replace: true });
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("create_company", { p_name: name.trim(), p_vat_registered: vat === "registered" }));
    },
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (blocked()) return;
    save.mutate();
  }

  const step = 1;
  const steps = 1;
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
      <ScreenHeader title="פרטי העסק" subtitle="השם שיופיע בבית." backTo={`/sign-in${search}`} />
      <form className="ui-page-pad" onSubmit={submit}>
        <TextField label="שם העסק" value={name} onChange={(event) => { setName(event.target.value); }} required minLength={2} />
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
        <Button type="submit" busy={save.isPending}>המשך</Button>
      </form>
    </main>
  );
}

export function ProjectsScreen({ sample }: { sample?: Dashboard } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const dashboard = useDashboardQuery(sample == null);
  const books = useBooks();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
        body="פרויקטים מגיעים מ־SUMIT, ואפשר גם לפתוח אחד כאן."
        action={<Button variant="pill" icon={<PlusIcon size={16} />} onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
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
        action={<Button variant="pill" icon={<PlusIcon size={16} />} onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
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

function projectMargin(project: { income_agorot: bigint; profit_agorot: bigint }): ReactNode | undefined {
  if (project.income_agorot <= 0n) return undefined;
  const pct = Number((project.profit_agorot * 100n) / project.income_agorot);
  const shown = pct < 0 ? `−${String(Math.abs(pct))}%` : `${String(pct)}%`;
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
  const shown = expanded ? projects : active.slice(0, 6);
  const restActive = Math.max(0, active.length - 6);
  const needle = query.trim();
  const visible = shown.filter((project) => needle === "" || project.name.includes(needle) || (project.state_label ?? "").includes(needle));
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
          {visible.map((project) => (
            <ListRow
              key={project.id}
              variant="project"
              title={project.name}
              hint={project.status === "finished" ? "הסתיים" : (projectMargin(project) ?? project.state_label ?? undefined)}
              agorot={project.profit_agorot}
              loss={project.profit_agorot < 0n}
              href={`/projects/${project.id}${search}`}
            />
          ))}
        </List>
      )}
      {!expanded && needle === "" && (restActive > 0 || finished.length > 0) ? (
        <p className="ui-page-pad">
          <TextLink tone="quiet" onClick={() => { setExpanded(true); }}>
            עוד <bdi dir="ltr">{String(restActive)}</bdi> פעילים · <bdi dir="ltr">{String(finished.length)}</bdi> הסתיימו
          </TextLink>
        </p>
      ) : null}
    </>
  );
}

function ProjectForm({ onClose, projectId }: { onClose: () => void; projectId?: string }) {
  const blocked = useBlockedPreview();
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
    if (blocked()) return;
    save.mutate();
  }

  return (
    <form className="ui-stack" onSubmit={submit}>
      <TextField label="שם" value={name} onChange={(event) => { setName(event.target.value); }} required />
      <MoneyField label="תקציב בשקלים, או ריק" value={budget} onValueChange={setBudget} />
      <Button type="submit" busy={save.isPending}>שמירה</Button>
      <Button variant="secondary" onClick={onClose}>ביטול</Button>
    </form>
  );
}

function ProjectLoading({ search, example }: { search: string; example?: ReactNode }) {
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
        trailing={
          <IconButton label="עוד" onBand onClick={() => { setMenu(true); }}>
            <MoreIcon />
          </IconButton>
        }
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
      <Sheet open={menu} onOpenChange={setMenu} title="עוד">
        <p className="t-hint">הפרויקט עדיין נטען.</p>
      </Sheet>
    </div>
  );
}

function pendingApprovalTitle(count: number): string {
  return count === 1 ? "1 ממתינה לאישור" : `${String(count)} ממתינות לאישור`;
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
  const pending = project.pending_count ?? 0;
  const waiting = pending > 0;
  const shared = project.categories.some((category) => category.has_shared_share === true);
  if (project.categories.length === 0 && !waiting) {
    return <p className="ui-page-pad t-hint">אין עדיין הוצאות מסווגות.</p>;
  }
  return (
    <>
      {shared ? <SharedCostNote /> : null}
      <List>
      {project.categories.map((category) => (
        <ListRow
          key={category.id ?? category.name}
          variant="project"
          title={category.name ?? "בלי קטגוריה"}
          agorot={absAgorot(category.amount_agorot)}
          loss={false}
          chevron={category.id != null}
          href={category.id == null ? undefined : (categoryTo ?? `/projects/${project.id}/categories/${category.id}${search}`)}
        />
      ))}
      {waiting ? (
        <ListRow
          variant="project"
          title={pendingApprovalTitle(pending)}
          agorot={absAgorot(project.pending_agorot ?? 0n)}
          loss={false}
          chevron
          href={`/review${withParam(search, "project", project.id)}`}
        />
      ) : null}
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
  const [moves, setMoves] = useState(false);
  const [overheadOn, setOverheadOn] = useState(sample?.after_overhead === true);
  const wantedOverhead = useRef(false);
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
  const profit = shownProfit(
    overheadOn,
    project.overhead_weighted === true,
    project.profit_agorot,
    project.profit_after_overhead_agorot,
  );
  const income = absAgorot(project.income_agorot);
  const expenses = absAgorot(project.direct_agorot) + absAgorot(project.shared_agorot);
  const margin = income > 0n ? Number((profit * 100n) / income) : null;
  const marginShown = margin == null ? null : margin < 0 ? `−${String(Math.abs(margin))}%` : `${String(margin)}%`;
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        example={example}
        leading={
          <BackButton fallback={`/projects${search}`} onBand />
        }
        trailing={<ProjectMenu projectId={project.id} name={project.name} budget={project.budget_agorot ?? null} finished={project.status === "finished"} />}
      >
        <BandHero>
          <FocusTitle className="t-title-2">{project.name}</FocusTitle>
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
          <p className="t-display"><BigNumber agorot={profit} /></p>
          <BandFigures income={formatIls(income)} expense={formatIls(expenses)} />
        </BandHero>
      </TopBand>
      <div className="ui-page-pad">
        <Toggle
          label="אחרי חלק בהוצאות כלליות"
          hint={overheadHint(overheadOn, {
            available: project.overhead_weighted === true,
            shareAgorot: project.overhead_share_agorot,
          })}
          checked={overheadOn}
          onChange={(checked) => {
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
          }}
        >
          תנועות אחרונות
        </TextLink>
      </p>
      {moves ? (
        project.transactions.length === 0 ? (
          <EmptyState icon={<DocumentIcon />} title="אין עדיין תנועות" body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן." />
        ) : (
          <List>
            {project.transactions.map((txn) => (
              <ListRow
                key={txn.id}
                variant="transaction"
                title={txn.description}
                hint={`${txn.category ? `${txn.category} · ` : ""}${formatDayMonth(txn.doc_date)}`}
                agorot={txn.amount_net}
                sign={txn.direction === "income" ? "in" : "out"}
                source="invoice"
                href={`/transactions/${txn.id}${search}`}
              />
            ))}
          </List>
        )
      ) : null}
    </div>
  );
}

function LegacyEmptyProject() {
  const search = usePreviewSearch();
  const location = useLocation();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        leading={
          <BackButton fallback={`/projects${search}`} onBand />
        }
      >
        <BandHero>
          <FocusTitle className="t-title-2">פרויקט</FocusTitle>
          <p className="ui-band-label t-label">רווח</p>
          <p className="t-display"><BigNumber agorot={0n} /></p>
        </BandHero>
      </TopBand>
      <EmptyState
        icon={<DocumentIcon />}
        title="אין עדיין תנועות"
        body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן."
        action={
          <Button variant="pill" to={`/add${search}`} state={withSheetBackground(location)}>
            <CameraIcon />
            צילום חשבונית
          </Button>
        }
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
  const rows = shown ?? filed.data ?? [];
  return (
    <ScreenState
      title="שויכו היום"
      subtitle="אפשר לפתוח כל תנועה ולשנות את השיוך"
      backTo={backTo ?? `/review${search}`}
      phase={phase.kind === "ready" && rows.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void filed.refetch(); }}
      empty={<EmptyState icon={<ReviewIcon />} title="אין תנועות ששויכו היום" body="כש־SUMIT משייך תנועה בלי תור, היא תופיע כאן." />}
    >
      <List>
        {rows.map((row) => (
          <ListRow
            key={row.id}
            variant="transaction"
            title={row.supplier_name ?? row.description}
            hint={[row.project_name, row.category_name].filter((part) => part != null && part !== "").join(" · ")}
            agorot={row.amount_net}
            sign={row.direction === "income" ? "in" : "out"}
            source="invoice"
            href={rowHref ? rowHref(row) : `/transactions/${row.id}${search}`}
          />
        ))}
      </List>
    </ScreenState>
  );
}

export function ReviewScreen() {
  const preview = useHomePreview();
  const search = useFlowSearch();
  const [params] = useSearchParams();
  const projectFilter = params.get("project");
  const review = useReviewQuery();
  const waiting = useProjectWaitingQuery(projectFilter ?? "");
  const phase = screenPhase(preview, review);
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
      const rows = (review.data ?? []).filter((row) => ids.has(row.id));
      if (rows.length === 0) return <ReviewEmpty search={search} filtered backTo={back} homeTo={back} homeLabel="חזרה לפרויקט" />;
      return (
        <ReviewQueue
          rows={rows}
          search={search}
          backTo={back}
          homeTo={back}
          homeLabel="חזרה לפרויקט"
        />
      );
    }
    return <ProjectWaitingList rows={held} search={search} backTo={back} />;
  }
  const rows = review.data ?? [];
  if (phase.kind === "empty" || (phase.kind === "ready" && rows.length === 0)) {
    return <ReviewEmpty search={search} />;
  }
  if (phase.kind !== "ready") {
    return <ScreenState title="לאישור" phase={phase} onRetry={() => { void review.refetch(); }} />;
  }
  return <ReviewQueue rows={rows} search={search} />;
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
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="הוצאות שמחכות לאישור בפרויקט הזה" backTo={backTo} />
      <List>
        {rows.map((row) => (
          <ListRow
            key={row.transaction_id}
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
        ))}
      </List>
    </div>
  );
}

export type ReviewPreviewWrite = {
  run: () => Promise<void>;
  onDone: (id: string) => void;
  onUndo: (id: string) => void;
};

export function ReviewQueue({
  rows,
  search,
  sample = false,
  previewWrite,
  changeTo,
  filedTo,
  backTo,
  homeTo,
  homeLabel,
  onShared,
}: {
  rows: ReviewRow[];
  search: string;
  sample?: boolean;
  /** Injected by the dev and reviewer previews. The hosted queue does not set it. */
  previewWrite?: ReviewPreviewWrite;
  /** Preview sends שינוי to its own save screen. */
  changeTo?: string;
  /** Preview sends צפייה to its own filed list. */
  filedTo?: string;
  backTo?: string;
  /** Preview returns an empty queue to its index. */
  homeTo?: string;
  /** Label for that return. The product queue says לדף הבית. */
  homeLabel?: string;
  /** Preview opens its own split instead of the ledger split. */
  onShared?: (transactionId: string) => void;
}) {
  const preview = useHomePreview();
  const navigate = useNavigate();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const invalidate = useInvalidateBooks();
  const [hideAuto, setHideAuto] = useState(false);
  const [shown, setShown] = useState<ReviewRow | null>(rows[0] ?? null);
  const [motion, setMotion] = useState<"still" | "out" | "in">("still");
  const visit = useRef({ total: rows.length, seen: new Set(rows.map((item) => item.id)) });
  let added = 0;
  for (const item of rows) {
    if (visit.current.seen.has(item.id)) continue;
    visit.current.seen.add(item.id);
    added += 1;
  }
  if (added > 0) visit.current.total += added;
  const row = rows[0];
  const leaving = motion === "out";
  useEffect(() => {
    const next = rows[0] ?? null;
    if (next?.id === shown?.id) {
      if (
        next != null
        && shown != null
        && (next.category_name !== shown.category_name
          || next.category_id !== shown.category_id
          || next.category_suggested !== shown.category_suggested
          || next.project_suggested !== shown.project_suggested
          || next.project_name !== shown.project_name
          || next.share_count !== shown.share_count)
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
      setShown(next);
      setMotion(next ? "in" : "still");
    }, reduce ? 0 : 200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [rows, shown]);
  const approve = useWrite({
    failure: previewWrite ? changeSaveFailure : "לא הצלחנו לאשר.",
    keys: ["review", "dashboard", "unpaid", "project", "project-category", "project-waiting", "filed-today", "txn"],
    run: async () => {
      if (previewWrite) {
        await previewWrite.run();
        return;
      }
      if (!row?.category_id) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      if (reviewIsSplit(row) && row.reason !== "unallocated_shared") {
        assertNoError(await supabase.rpc("approve_split_review", { p_id: row.id }));
        return;
      }
      if (row.direction !== "income" && !row.project_id) throw new Error("missing");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: row.id,
        p_action: "approved",
        ...(row.direction === "income" || row.project_id == null ? {} : { p_project_id: row.project_id }),
        p_category_id: row.category_id,
        p_remember: false,
      }));
    },
    onSuccess: () => {
      if (!row) return;
      const id = row.id;
      if (previewWrite) {
        previewWrite.onDone(id);
        toast.show({
          message: "הפריט אושר",
          action: "ביטול",
          onAction: () => {
            previewWrite.onUndo(id);
          },
        });
        return;
      }
      toast.show({
        message: "הפריט אושר",
        action: "ביטול",
        onAction: () => {
          void reopenReview(id, invalidate, toast);
        },
      });
    },
  });
  const skip = useWrite({
    failure: previewWrite ? changeSaveFailure : "לא הצלחנו לדלג.",
    success: "דילגנו על הפריט",
    keys: ["review", "project", "project-category", "project-waiting"],
    run: async () => {
      if (previewWrite) {
        await previewWrite.run();
        return;
      }
      if (!row) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: row.id,
        p_action: "skipped",
      }));
    },
    onSuccess: () => {
      if (previewWrite && row) previewWrite.onDone(row.id);
    },
  });
  const card = shown;
  if (!card) return <ReviewEmpty search={search} homeTo={homeTo} homeLabel={homeLabel} backTo={backTo} />;
  const change = changeTo ? withItem(changeTo, card.id) : `/review/change${search}${search ? "&" : "?"}item=${card.id}`;
  const auto = card.auto_approved_today ?? 0;
  const suggestion = reviewSuggestion(card);
  const total = Math.max(visit.current.total, 1);
  const index = row ? total - rows.length + 1 : total;
  const splitCard = reviewIsSplit(row);
  const approvable = !leaving && row != null && (row.reason === "unallocated_shared"
    || (splitCard
      ? row.category_id != null
      : row.direction === "income"
        ? row.category_id != null
        : row.project_id != null && row.category_id != null));
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" backTo={backTo} />
      <div className="ui-review-meter">
        <ProgressBar
          variant="thin"
          label="התקדמות התור"
          value={index}
          max={total}
          caption={
            <span className="t-hint">
              <bdi dir="ltr">{String(index)}</bdi> מתוך <bdi dir="ltr">{String(total)}</bdi>
            </span>
          }
        />
      </div>
      {auto > 0 && !hideAuto ? (
        <Banner
          icon={<ReviewIcon />}
          title={
            <>
              <bdi dir="ltr">{String(auto)}</bdi> תנועות שויכו היום בלי להמתין בתור
            </>
          }
          action={
            <>
              <TextLink to={filedTo ?? `/review/filed${search}`}>צפייה</TextLink>
              <IconButton label="סגירה" onClick={() => { setHideAuto(true); }}>
                <CloseIcon />
              </IconButton>
            </>
          }
        />
      ) : null}
      <div className="ui-review-motion" data-motion={motion === "still" ? undefined : motion} key={card.id}>
        <ReviewCard
          supplier={card.supplier_name ?? card.description}
          sourceLine={`${docKindLabel(card.doc_kind)} · ${invoiceDate(card.doc_date)}`}
          netAgorot={card.amount_net}
          vatLine={reviewVatLine(card.vat_agorot)}
          suggestion={suggestion}
          reason={card.reason}
        />
      </div>
      <div className="ui-review-actions">
        <Button
          full
          busy={approve.isPending}
          disabled={!approvable}
          onClick={() => {
            if (row == null || !approvable) return;
            if (previewWrite == null && blocked(sample ? "empty" : preview)) return;
            if (row.reason === "unallocated_shared") {
              if (!row.transaction_id) return;
              if (onShared) {
                onShared(row.transaction_id);
                return;
              }
              void navigate(`/transactions/${row.transaction_id}/split${search}`);
              return;
            }
            approve.mutate();
          }}
          icon={<CheckIcon />}
        >
          אישור
        </Button>
        <div className="ui-review-actions-row">
          <Button variant="secondary" to={change}>שינוי</Button>
          <Button
            variant="ghost"
            busy={skip.isPending}
            disabled={leaving}
            onClick={() => {
              if (leaving) return;
              if (previewWrite == null && blocked(sample ? "empty" : preview)) return;
              skip.mutate();
            }}
          >
            דלג
          </Button>
        </div>
      </div>
    </div>
  );
}

function withItem(to: string, id: string): string {
  const [path, query = ""] = to.split("?");
  const params = new URLSearchParams(query);
  params.set("item", id);
  return `${String(path)}?${params.toString()}`;
}

function invoiceDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

function reviewVatLine(vat: bigint | undefined): string {
  if (vat == null) return "לפני מע״מ";
  if (vat === 0n) return "פטור ממע״מ";
  const shown = vat < 0n ? -vat : vat;
  return `לפני מע״מ · מע״מ ${formatIls(shown)}`;
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

function reviewSuggestion(row: ReviewRow) {
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
  };
}

async function reopenReview(
  id: string,
  invalidate: (keys: string[]) => Promise<void>,
  toast: { show: (input: { message: string; tone?: "ok" | "bad"; action?: string; onAction?: () => void }) => void },
) {
  try {
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    assertNoError(await supabase.rpc("reopen_review", { p_id: id }));
    await invalidate(["review", "dashboard", "project", "project-category", "project-waiting", "filed-today", "txn"]);
    toast.show({ message: "הפריט חזר לתור, והשיוך הקודם שוחזר." });
  } catch {
    toast.show({
      tone: "bad",
      message: "לא הצלחנו לבטל.",
      action: "ניסיון חוזר",
      onAction: () => {
        void reopenReview(id, invalidate, toast);
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
}: {
  search: string;
  filtered?: boolean;
  homeTo?: string;
  homeLabel?: string;
  backTo?: string;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" backTo={backTo} />
      <EmptyState
        icon={<ReviewIcon />}
        title={filtered ? "אין פריטים לאישור בפרויקט הזה" : "הכל מאושר"}
        body={filtered ? "אין פריטים של הפרויקט הזה בתור." : "אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."}
        action={<Button variant="pill" to={homeTo ?? `/${search}`}>{homeLabel ?? "לדף הבית"}</Button>}
      />
    </div>
  );
}

type CategorySample = {
  categoryName: string;
  projectName: string;
  rows: Array<{ id: string; description: string; doc_date: string; amount_net: bigint }>;
  /** Shows עוד תנועות until the rest of the sample rows are revealed. */
  pageSize?: number;
};

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
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const category = useProjectCategoryQuery(sample ? "" : projectId, sample ? "" : categoryId);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, category);
  const [sampleOpen, setSampleOpen] = useState(false);
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
  const allRows = sample?.rows ?? (category.data?.pages.flatMap((page) => page?.rows ?? []) ?? []);
  const rows = sample?.pageSize != null && !sampleOpen ? allRows.slice(0, sample.pageSize) : allRows;
  const more = sample?.pageSize != null ? !sampleOpen && allRows.length > sample.pageSize : !sample && category.hasNextPage;
  return (
    <div>
      <ScreenHeader title={name} subtitle={projectName} backTo={backOverride ?? back} />
      {rows.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין תנועות בקטגוריה הזו" body="הוצאות משויכות של הפרויקט יופיעו כאן." />
      ) : (
        <List>
          {rows.map((txn) => (
            <ListRow
              key={txn.id}
              variant="transaction"
              title={txn.description}
              hint={formatDayMonth(txn.doc_date)}
              agorot={txn.amount_net}
              sign="out"
              source="invoice"
              href={rowHref ? rowHref(txn) : `/transactions/${txn.id}${search}`}
            />
          ))}
        </List>
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

export function reviewIsSplit(row: { reason?: string | null; pnl_role?: string | null; share_count?: number | null } | null | undefined): boolean {
  if (!row) return false;
  return row.pnl_role === "shared" || (row.share_count ?? 0) > 1 || row.reason === "unallocated_shared";
}

export function reviewSplitTitle(row: { project_name?: string | null; share_count?: number | null; reason?: string | null }): string {
  if ((row.share_count ?? 0) > 1) return `מפוצל · ${String(row.share_count)} פרויקטים`;
  if (row.project_name) return row.project_name;
  return "עלות משותפת · טרם פוצלה";
}

export function ChangeForm({ sample }: { sample?: ChangeSample } = {}) {
  const search = useFlowSearch();
  const preview = useHomePreview();
  const navigate = useNavigate();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const invalidate = useInvalidateBooks();
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const review = useReviewQuery(sample == null);
  const [params] = useSearchParams();
  const item = params.get("item") ?? "";
  const live = (review.data ?? []).find((entry) => entry.id === item);
  const [kept, setKept] = useState<ReviewRow | null>(null);
  useEffect(() => {
    if (live) setKept(live);
  }, [live]);
  const row = live ?? (kept?.id === item ? kept : null);
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
    const complete = income || splitReview ? categoryId !== "" : projectId !== "" && categoryId !== "";
    if (complete) setHold("");
  }, [hold, income, splitReview, projectId, categoryId]);
  useEffect(() => {
    if (leaveNote !== "" && remember === savedRemember) setLeaveNote("");
  }, [leaveNote, remember, savedRemember]);
  useEffect(() => {
    if (sample || !row || seeded.current) return;
    seeded.current = true;
    const nextProject = row.project_id ?? "";
    const nextCategory = row.category_id ?? "";
    baseline.current = { projectId: nextProject, categoryId: nextCategory, remember: true };
    setProjectId(nextProject);
    setCategoryId(nextCategory);
  }, [sample, row]);
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
  const suggestionProjectId = sample
    ? (sample.project_suggested === false ? "" : (sample.suggestionId ?? ""))
    : (row?.project_suggested === true ? (row.project_id ?? "") : "");
  const suggestionCategoryId = sample?.suggestionCategoryId ?? sample?.categoryId ?? row?.category_id ?? "";
  const projectOptions = withChoice(
    [...(sample?.projects ?? (dashboard.data?.projects ?? []).map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
    }))), ...extraProjects],
    projectId,
    row?.project_name,
  );
  const categoryOptions = withChoice(
    (sample?.categories ?? categories.data ?? []).filter((category) => {
      if (category.hidden) return false;
      return income ? category.kind === "income" : category.kind !== "income";
    }).map((category) => ({ id: category.id, name: category.name })),
    categoryId,
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
        ...(income ? {} : { p_project_id: next.projectId }),
        p_category_id: next.categoryId,
        p_remember: next.remember,
      }));
    },
  });
  const setSharedCategory = useWrite({
    failure: changeSaveFailure,
    success: "השיוך נשמר",
    keys: ["review", "dashboard", "project", "project-category", "project-waiting", "txn"],
    onSuccess: () => {
      setCategoryId(picked.current.categoryId);
    },
    run: async () => {
      const supabase = getSupabase();
      const transactionId = sharedTx.current;
      const nextCategory = picked.current.categoryId;
      if (!supabase || transactionId == null || nextCategory === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("set_transaction_category", {
        p_id: transactionId,
        p_category_id: nextCategory,
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
      if (!income && next.projectId === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("reassign_transaction", {
        p_id: transactionId,
        p_project_id: income ? (null as unknown as string) : next.projectId,
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
    return saveNewProject(name, blocked, toast, (project) => {
      setExtraProjects((list) => [...list, project]);
    }, invalidate);
  }

  if (formPhase.kind !== "ready") {
    return (
      <RouteSheet title="שינוי שיוך" closeTo={`/review${search}`}>
        <ScreenState title="שינוי שיוך" phase={formPhase} onRetry={() => { void dashboard.refetch(); void categories.refetch(); void review.refetch(); }} />
      </RouteSheet>
    );
  }

  return (
    <ChangeAssignment
      host="route"
      closeTo={`/review${search}`}
      supplier={sample?.supplier ?? row?.supplier_name ?? row?.description ?? ""}
      amount={sample?.amount ?? (row ? formatIls(absAgorot(row.amount_net)) : "")}
      direction={income ? "income" : "expense"}
      projects={projectOptions}
      categories={categoryOptions}
      projectId={projectId}
      categoryId={categoryId}
      suggestionProjectId={suggestionProjectId}
      suggestionCategoryId={suggestionCategoryId}
      onProjectId={setProjectId}
      onCategoryId={setCategoryId}
      {...(income || splitReview ? {} : { remember, onRemember: setRemember })}
      categorySuggested={sample ? sample.categorySuggested !== false : row?.category_suggested !== false}
      hold={hold || leaveNote}
      pending={!income && !splitReview && remember !== savedRemember && !wroteReview.current && !closedReview.current}
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
        if (sample) return undefined;
        if (blocked()) throw new Error("preview");
        const nextProject = kind === "project" ? id : projectId;
        const nextCategory = kind === "category" ? id : categoryId;
        picked.current = { projectId: nextProject, categoryId: nextCategory, remember };
        if (splitReview) {
          if (kind === "project") {
            if (!row?.transaction_id || id === "") throw new Error("supabase");
            await collapseShared.mutateAsync();
            return undefined;
          }
          if (!row?.transaction_id) throw new Error("supabase");
          await setSharedCategory.mutateAsync();
          return undefined;
        }
        const complete = income ? nextCategory !== "" : nextProject !== "" && nextCategory !== "";
        if (!complete) {
          setHold(income ? "בחרו קטגוריה." : "בחרו פרויקט וקטגוריה.");
          return undefined;
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
        const complete = income || splitReview ? categoryId !== "" : projectId !== "" && categoryId !== "";
        if (!complete) {
          setHold(income || splitReview ? "בחרו קטגוריה." : "בחרו פרויקט וקטגוריה.");
          return Promise.reject(new Error("incomplete"));
        }
        if (!splitReview && remember !== savedRemember && (wroteReview.current || closedReview.current)) {
          setLeaveNote("הזכירה נשמרת עם השיוך. החזירו את המתג כדי לסגור.");
          return Promise.reject(new Error("remember"));
        }
        return Promise.resolve();
      }}
      onCommitPending={async () => {
        if (sample) return;
        if (blocked()) throw new Error("preview");
        setHold("");
        picked.current = { projectId, categoryId, remember };
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
          icon={<CameraIcon size={26} />}
          onClick={() => undefined}
        />
        <ListRow
          variant="button"
          disabled
          title="הזנה ידנית"
          hint="סכום, פרויקט וקטגוריה – רק במקרה הצורך"
          icon={<PencilIcon size={26} />}
          onClick={() => undefined}
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
  const rows = all.filter((row) => !hidden.includes(row.id));
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

export function TransactionScreen({
  sample,
  sampleProjects,
  sampleCategories,
  onOpenSplit,
  onSampleUnsplit,
  onSampleUndo,
}: {
  sample?: NonNullable<TransactionDetail>;
  sampleProjects?: Array<{ id: string; name: string; code?: string }>;
  sampleCategories?: Array<{ id: string; name: string }>;
  /** Reviewer preview stays on its own split instead of the ledger route. */
  onOpenSplit?: () => void;
  /** Sample books update when a split becomes one project. */
  onSampleUnsplit?: (projectId: string) => void;
  onSampleUndo?: () => void;
} = {}) {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const invalidate = useInvalidateBooks();
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const leaveChange = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const setChangeSheet = useSheetHistory("txn-change", changeOpen, setChangeOpen, () => leaveChange.current());
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const detail = useTransactionQuery(sample ? "" : transactionId);
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const remove = useWrite({
    failure: "לא הצלחנו למחוק.",
    keys: ["dashboard", "txn", "unpaid", "review"],
    onSuccess: () => {
      setConfirm(false);
      void navigate(`/${search}`);
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
  const [projectName, setProjectName] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [hold, setHold] = useState("");
  const [collapsedTo, setCollapsedTo] = useState<{ id: string; name: string } | null>(null);
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
    const splitLike = collapsedTo == null && (txn.pnl_role === "shared" || txn.review_reason === "unallocated_shared" || (txn.allocations?.length ?? 0) > 1);
    const complete = (splitLike || txn.direction === "income")
      ? categoryId !== ""
      : projectId !== "" && categoryId !== "";
    if (complete) setHold("");
  }, [hold, txn, categoryId, projectId, collapsedTo]);
  const undoId = useRef<string | null>(null);
  const undo = useWrite({
    failure: "לא הצלחנו לבטל את השיוך.",
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
    success: "השיוך הקודם חזר",
    onSuccess: () => {
      committed.current = { projectId: "", categoryId: "" };
      setProjectName("");
      setCategoryName("");
      setCollapsedTo(null);
      onSampleUndo?.();
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
      if (!supabase || next.projectId === "" && current.direction !== "income" || next.categoryId === "") throw new Error("supabase");
      const saved = await supabase.rpc("reassign_transaction", {
        p_id: current.id,
        p_project_id: current.direction === "income" ? (null as unknown as string) : next.projectId,
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
  const collapse = useWrite({
    failure: changeSaveFailure,
    keys: ["txn", "dashboard", "project", "project-category", "project-waiting", "review"],
    onSuccess: () => {
      applyRef.current();
      const nextId = writeTarget.current.projectId;
      const named = namesRef.current.projects.find((project) => project.id === nextId);
      setCollapsedTo({ id: nextId, name: named?.name ?? "" });
      const id = undoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
      });
    },
    run: async () => {
      const current = sample ?? detail.data;
      if (!current) throw new Error("supabase");
      undoId.current = await collapseSplit(current.id, writeTarget.current.projectId);
    },
  });
  if (phase.kind === "loading" || phase.kind === "error" || phase.kind === "empty") {
    return <ScreenState title="פרטי תנועה" backTo={parent} phase={phase.kind === "empty" ? { kind: "empty" } : phase} onRetry={() => { void detail.refetch(); }} empty={<p className="ui-page-pad t-hint">אין תנועה להצגה.</p>} />;
  }
  if (!txn) return <ScreenHeader title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={parent} />;
  const detailRow = txn;
  const serverSplit = detailRow.pnl_role === "shared" || detailRow.review_reason === "unallocated_shared" || (detailRow.allocations?.length ?? 0) > 1;
  const splitRow = collapsedTo == null && serverSplit;
  const shownProject = collapsedTo?.name || splitProjectLabel(txn, splitRow, projectName || txn.project_name || "בלי פרויקט");
  const shownCategory = categoryName || txn.category_name || "בלי קטגוריה";
  function openSplit() {
    if (onOpenSplit) {
      onOpenSplit();
      return;
    }
    void navigate(`/transactions/${detailRow.id}/split${search}`);
  }
  async function commitPick(kind: "project" | "category", id: string) {
    const previous = { projectId, categoryId };
    const collapsing = kind === "project" && splitRow;
    const next = {
      projectId: kind === "project" ? id : previous.projectId,
      categoryId: kind === "category" ? id : previous.categoryId,
    };
    writeTarget.current = next;
    const complete = collapsing
      ? next.projectId !== ""
      : splitRow
        ? next.categoryId !== ""
        : detailRow.direction === "income"
          ? next.categoryId !== ""
          : next.projectId !== "" && next.categoryId !== "";
    if (!complete) {
      setHold(collapsing ? COLLAPSE_PICK_HOLD : detailRow.direction === "income" || splitRow ? "בחרו קטגוריה." : "בחרו פרויקט וקטגוריה.");
      return undefined;
    }
    setHold("");
    try {
      if (sample) {
        applyRef.current();
        if (collapsing) {
          const named = namesRef.current.projects.find((project) => project.id === id);
          setCollapsedTo({ id, name: named?.name ?? "" });
          onSampleUnsplit?.(id);
          toast.show({
            message: "השיוך נשמר",
            action: "ביטול",
            onAction: () => {
              setCollapsedTo(null);
              committed.current = { projectId: "", categoryId: committed.current.categoryId };
              setProjectId("");
              setProjectName("");
              onSampleUndo?.();
            },
          });
          return undefined;
        }
        toast.show({ message: "השיוך נשמר" });
        return undefined;
      }
      if (blocked()) throw new Error("preview");
      if (collapsing) await collapse.mutateAsync();
      else if (splitRow) await setCategory.mutateAsync();
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
  const changeCategories = withChoice(
    (sample
      ? (sampleCategories ?? [])
      : (categories.data ?? []).filter((category) => !category.hidden && (txn.direction === "income" ? category.kind === "income" : category.kind !== "income"))
    ).map((category) => ({ id: category.id, name: category.name })),
    categoryId,
    txn.category_name,
  );
  const reviewLabel = txn.review_status === "open" ? "ממתין לאישור" : txn.review_status === "approved" || txn.review_status === "changed" ? "מאושר" : null;
  const paymentLabel = txn.open_gross_agorot != null && txn.open_gross_agorot !== 0n ? "טרם נגבה" : txn.paid === true ? "שולם" : null;
  return (
    <div>
      <ScreenHeader
        title={txn.direction === "income" ? "הכנסה" : "הוצאה"}
        size="compact"
        leading={<BackButton fallback={parent} />}
        trailing={<IconButton label="עוד" onClick={() => { setMenu(true); }}><MoreIcon /></IconButton>}
      />
      <div className="ui-page-pad">
        <p className="t-title-3">{party}</p>
        <p className="t-display"><BigNumber agorot={absAgorot(txn.amount_net)} presentation="detail" /></p>
        <p className="t-hint">לפני מע״מ · <bdi dir="ltr">{invoiceDate(txn.doc_date)}</bdi></p>
        {reviewLabel || paymentLabel ? (
          <div className="ui-status-row">
            {reviewLabel ? <StatusPill>{reviewLabel}</StatusPill> : null}
            {paymentLabel ? <StatusPill>{paymentLabel}</StatusPill> : null}
          </div>
        ) : null}
      </div>
      <List>
        <ListRow variant="button" eyebrow="פרויקט" title={shownProject} icon={<ProjectsIcon />} chevron onClick={() => {
          if (splitRow) {
            openSplit();
            return;
          }
          setChangeSheet(true);
        }} />
        <ListRow variant="button" eyebrow="קטגוריה" title={shownCategory} icon={<TagIcon />} chevron onClick={() => { setChangeSheet(true); }} />
        <ListRow
          variant="button"
          title="חשבונית ותשלום"
          hint="מע״מ, מספר חשבונית, שורת הבנק"
          icon={<DocumentIcon size={22} />}
          action={<ChevronDownIcon />}
          expanded={docOpen}
          onClick={() => { setDocOpen((open) => !open); }}
        />
      </List>
      {docOpen ? (
        <p className="ui-page-pad t-hint">
          מע״מ <bdi dir="ltr">{formatIls(txn.vat_amount, { agorot: true })}</bdi>
          {" · "}
          {vatStatusLabel(txn.vat_status)}
        </p>
      ) : null}
      <div className="ui-stack ui-page-pad">
        {onOpenSplit ? (
          <Button variant="secondary" icon={<SplitIcon />} onClick={openSplit}>פיצול בין פרויקטים</Button>
        ) : (
          <Button variant="secondary" icon={<SplitIcon />} to={`/transactions/${txn.id}/split${search}`}>פיצול בין פרויקטים</Button>
        )}
      </div>
      <ChangeAssignment
        host="overlay"
        open={changeOpen}
        onOpenChange={setChangeSheet}
        supplier={party}
        amount={formatIls(absAgorot(txn.amount_net))}
        direction={txn.direction === "income" ? "income" : "expense"}
        projects={changeProjects}
        categories={changeCategories}
        projectId={projectId}
        categoryId={categoryId}
        onProjectId={setProjectId}
        onCategoryId={setCategoryId}
        projectNote={splitRow ? COLLAPSE_SPLIT_NOTE : undefined}
        projectTitle={splitRow ? shownProject : undefined}
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
      <Sheet open={menu} onOpenChange={setMenu} title="עוד">
        {txn.source === "manual" ? (
          <Button variant="danger" icon={<TrashIcon />} onClick={() => { setMenu(false); setConfirm(true); }}>מחיקה</Button>
        ) : (
          <p className="t-hint">תנועה מ־SUMIT לא נמחקת כאן. היא מתעדכנת בסנכרון.</p>
        )}
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

function splitDraftKey(id: string): string {
  return `flow-split:${id}`;
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
    failure: () => "החלוקה לא נשמרה",
    success: "החלוקה נשמרה",
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
        } catch {
          toast.show({ tone: "bad", message: "החלוקה לא נשמרה", action: "ניסיון חוזר", onAction: () => { void leave(); } });
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
          api.toast.show({ tone: "bad", message: "החלוקה לא נשמרה" });
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
  if (phase.kind !== "ready" || active.length === 0) {
    return (
      <ScreenState
        title="חלוקה בין פרויקטים"
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
    ? `נשארו ${percentWords(manualLeft)}% לחלק`
    : manualLeft < 0
      ? `הסך ${percentWords(manualUsed)}%. צריך 100%.`
      : "הסך 100%";
  const oneName = [...active, ...extraProjects].find((project) => project.id === oneProject)?.name ?? "";
  const summary = !method
    ? "בחרו איך לחלק"
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
                ? `חלוקה ידנית · ${String(manualParts.length)} פרויקטים`
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
        title="חלוקה בין פרויקטים"
        leading={<IconButton label="סגירה" disabled={sampleSaving} onClick={() => { void leave(); }}><CloseIcon /></IconButton>}
        trailing={example}
      />
      <div className="ui-split-amount">
        <p className="t-title-1"><BigNumber agorot={amount} presentation="detail" /></p>
        {meta ? <p className="ui-split-meta t-label">{meta}</p> : null}
      </div>
      <h2 className="ui-split-question t-title-3">איך לחלק?</h2>
      <fieldset className="ui-split-body" disabled={busy}>
        <div className="ui-split-card" role="radiogroup" aria-label="איך לחלק?">
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
            <TextLink chevron={false} disabled={busy} onClick={openManual}>חלוקה ידנית</TextLink>
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

type SettingsSample = {
  name: string | null;
  vatRegistered: boolean;
  connected: boolean;
  companyId: number | null;
  lastError: string | null;
  nextAttemptAt?: string | null;
  email?: string | null;
  projectCount?: number;
  expenseCategories?: number;
  incomeCategories?: number;
  assistant?: AssistantSample;
};

export function SettingsScreen({
  sample,
}: {
  sample?: SettingsSample;
} = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const { session } = useAuth();
  const blocked = useBlockedPreview();
  const status = useSumitStatusQuery(sample == null);
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const setConnectSheet = useSheetHistory("sumit-connect", connectOpen, setConnectOpen);
  const setDisconnectSheet = useSheetHistory("sumit-disconnect", disconnectOpen, setDisconnectOpen);
  const [overheadOn, setOverheadOn] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const wantedOverhead = useRef(false);
  const retrySource = sample ? sample.nextAttemptAt : status.data?.next_attempt_at;
  useEffect(() => {
    if (!retrySource) return;
    const at = Date.parse(retrySource);
    const wait = at - Date.now();
    if (!Number.isFinite(wait) || wait <= 0) return;
    const id = window.setTimeout(() => { setClockNow(Date.now()); }, wait + 25);
    return () => { window.clearTimeout(id); };
  }, [retrySource]);
  useEffect(() => {
    if (sample) return;
    if (dashboard.data) setOverheadOn(dashboard.data.after_overhead === true);
  }, [sample, dashboard.data]);
  const phase = sample ? ({ kind: "ready" } as const) : combinePhase(screenPhase(preview, dashboard), screenPhase(preview, status));
  const saveOverhead = useWrite({
    failure: "לא הצלחנו לשמור את התצוגה.",
    keys: ["dashboard", "project"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_after_overhead", { p_on: wantedOverhead.current }));
    },
  });
  const connect = useWrite({
    failure: (error) => {
      if (error.message === "sumit_auth") return "החיבור נכשל. בדקו את המזהה ואת המפתח.";
      return hebrewSumitError(error.message) ?? "לא הצלחנו להתחבר. נסו שוב.";
    },
    success: "SUMIT מחובר. המפתח נשאר בשרת.",
    keys: ["sumit", "dashboard"],
    onSuccess: () => {
      setApiKey("");
      setConnectSheet(false);
    },
    run: async () => {
      await invokeEdge("sumit-connect", { companyId: Number(companyId), apiKey });
      setApiKey("");
    },
  });
  const refresh = useWrite({
    failure: (error) => hebrewSumitError(error.message) ?? "הרענון נכשל.",
    success: "הרענון הסתיים.",
    keys: ["sumit", "dashboard", "unpaid", "review", "project"],
    run: async () => {
      const data = await invokeEdge("sumit-sync", { force: true });
      if (data != null && typeof data === "object" && "skipped" in data && data.skipped === true) {
        throw new Error("sync_skipped");
      }
    },
  });
  const disconnect = useWrite({
    failure: "לא הצלחנו לנתק.",
    success: "החיבור נותק. הספרים נשארו.",
    keys: ["sumit"],
    onSuccess: () => { setDisconnectSheet(false); },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("disconnect_sumit"));
    },
  });
  const signOut = useWrite({
    failure: "לא הצלחנו לצאת.",
    keys: [],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  });

  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="הגדרות"
        phase={phase}
        onRetry={() => { void dashboard.refetch(); void status.refetch(); }}
      />
    );
  }

  const emptyAccount = phase.kind === "empty";
  const connected = emptyAccount ? false : sample ? sample.connected : status.data?.connected === true;
  const businessName = sample ? sample.name : dashboard.data?.name;
  const sumitId = sample ? sample.companyId : status.data?.sumit_company_id;
  const rawError = sample ? sample.lastError : status.data?.last_error;
  const lastError = hebrewSumitError(rawError);
  const authReconnect = rawError === "sumit_auth";
  const retry = authReconnect ? null : retryClockParts(retrySource, clockNow);
  const refreshHeld = authReconnect || retry != null;
  const retryHint = retry == null ? undefined : (
    <>
      {retry.tomorrow ? "אפשר לנסות שוב מחר ב-" : "אפשר לנסות שוב ב-"}
      <bdi className="ui-num" dir="ltr">{retry.clock}</bdi>
    </>
  );
  const refreshHint = authReconnect ? "המזהה או המפתח לא התקבלו" : retryHint;
  const email = sample ? sample.email : session?.user.email;
  const expenseCount = sample?.expenseCategories ?? categories.data?.filter((category) => category.kind === "expense" && !category.hidden).length;
  const incomeCount = sample?.incomeCategories ?? categories.data?.filter((category) => category.kind === "income" && !category.hidden).length;
  const categoryHint = expenseCount == null || incomeCount == null
    ? undefined
    : `${String(expenseCount)} הוצאות · ${String(incomeCount)} הכנסות`;
  const accountHint = !emptyAccount && email ? <bdi dir="ltr">{email}</bdi> : undefined;
  const showInstall = !isStandalone();
  const showSignOut = emptyAccount || preview === "off";
  return (
    <div>
      <ScreenHeader title="הגדרות" />
      <List>
        {emptyAccount ? (
          <ListRow variant="button" title="אין עסק עדיין" icon={<GoogleIcon />} disabled onClick={() => undefined} />
        ) : (
          <ListRow
            variant="static"
            title={businessName ?? "עדיין בלי עסק"}
            hint={accountHint}
            icon={<GoogleIcon />}
            describeHint={accountHint != null}
            wrapHint
          />
        )}
      </List>
      <SectionHead title="חיבורים" />
      <List>
        {connected ? (
          <ListRow
            variant="static"
            title="SUMIT מחובר"
            hint={<>מספר חברה <bdi dir="ltr">{String(sumitId ?? "")}</bdi></>}
            icon={<RefreshIcon />}
          />
        ) : (
          <ListRow variant="button" title="חיבור SUMIT" hint="מספר חברה ומפתח API" icon={<RefreshIcon />} chevron onClick={() => { setConnectSheet(true); }} />
        )}
        {connected ? (
          <ListRow
            variant="button"
            title="רענון עכשיו"
            hint={refreshHint}
            icon={<RefreshIcon />}
            chevron
            clearHint={authReconnect || retry != null}
            busy={refresh.isPending}
            disabled={refreshHeld}
            onClick={() => {
              if (refreshHeld) return;
              if (blocked()) return;
              refresh.mutate();
            }}
          />
        ) : null}
        {connected ? (
          <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} onClick={() => { setDisconnectSheet(true); }} />
        ) : null}
      </List>
      {lastError && !emptyAccount ? <div className="ui-page-pad"><FormError>{lastError}</FormError></div> : null}
      {rawError === "sumit_auth" && !emptyAccount ? (
        <div className="ui-page-pad">
          <Button variant="secondary" onClick={() => { setConnectSheet(true); }}>חיבור מחדש</Button>
        </div>
      ) : null}
      <AssistantSettings
        sample={sample ? (sample.assistant ?? { state: "empty" }) : undefined}
        noCompany={emptyAccount}
        blocked={blocked}
        showHeading={false}
      />
      <Sheet open={connectOpen} onOpenChange={setConnectSheet} title="חיבור SUMIT">
        <form
          className="ui-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (blocked()) return;
            connect.mutate();
          }}
        >
          <TextField label="מספר חברה" value={companyId} inputMode="numeric" onChange={(event) => { setCompanyId(event.target.value); }} />
          <TextField label="מפתח API" type="password" value={apiKey} autoComplete="off" onChange={(event) => { setApiKey(event.target.value); }} />
          <Button type="submit" busy={connect.isPending}>חיבור</Button>
        </form>
      </Sheet>
      <ConfirmSheet
        open={disconnectOpen}
        onOpenChange={setDisconnectSheet}
        title="לנתק את SUMIT?"
        consequence="המפתח נמחק. הספרים שכבר ירדו נשארים."
        confirmLabel="ניתוק"
        destructive
        busy={disconnect.isPending}
        onConfirm={() => {
          if (blocked()) return;
          disconnect.mutate();
        }}
      />
      {emptyAccount ? null : (
        <>
          <SectionHead title="תצוגה" />
          <List>
            <ListRow variant="item" href={`/settings/categories${search}`} title="קטגוריות" hint={categoryHint} icon={<TagIcon />} chevron />
          </List>
          <div className="ui-page-pad">
            <Toggle
              label="רווח אחרי חלק בכלליות"
              hint={overheadHint(overheadOn, { available: true, scope: "company" })}
              checked={overheadOn}
              onChange={(checked) => {
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
        </>
      )}
      {showInstall || showSignOut ? (
        <>
          <SectionHead title="עוד" />
          <List>
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
                  if (emptyAccount && blocked()) return;
                  signOut.mutate();
                }}
              />
            ) : null}
          </List>
        </>
      ) : null}
      <p className="ui-poc t-hint"><bdi dir="ltr">Flow 0.1</bdi></p>
    </div>
  );
}

function CategoryLine({
  category,
  muted = false,
  onMenu,
}: {
  category: CategoryRow & { count?: number };
  muted?: boolean;
  onMenu: () => void;
}) {
  return (
    <ListRow
      variant="item"
      title={category.name}
      muted={muted}
      meta={category.count == null ? undefined : category.count === 1 ? "תנועה אחת" : `${String(category.count)} תנועות`}
      action={
        <IconButton
          label={`עוד, ${category.name}`}
          onClick={onMenu}
        >
          <MoreIcon />
        </IconButton>
      }
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
  const blocked = useBlockedPreview();
  const categories = useCategoriesQuery(sample == null);
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
  const mergeTargets = rows.filter((category) => category.id !== mergeFrom && category.kind === kind && !category.hidden);
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
            onMenu={() => {
              setMenu(category);
            }}
          />
        ))}
      </List>
      ) : null}
      <div className="ui-cat-foot">
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
                  onMenu={() => {
                    setMenu(category);
                  }}
                />
              ))}
            </List>
          ) : null}
        </div>
      ) : null}
      <Sheet
        open={menu != null}
        onOpenChange={(open) => {
          if (!open) setMenu(null);
        }}
        title={menu?.name ?? "קטגוריה"}
      >
        <div className="ui-stack">
          <Button
            variant="secondary"
            onClick={() => {
              setHideTarget(menu);
              setMenu(null);
            }}
          >
            {menu?.hidden ? "החזרה לרשימה" : "הסתרה"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setMergeFrom(menu?.id ?? "");
              setMenu(null);
              setPickOpen(true);
            }}
          >
            מיזוג
          </Button>
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
      <ScreenHeader
        title="התראות"
        subtitle="אין עדיין התראות."
        backTo={`/settings${search}`}
      />
      <p className="t-hint ui-page-pad">בשלב הזה ההודעות לא נשלחות. אין שירות בתשלום ואין Push.</p>
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
