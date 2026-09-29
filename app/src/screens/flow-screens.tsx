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
import { Banner } from "../ui/banner";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { CheckRow } from "../ui/check-row";
import { StatusPill } from "../ui/chip";
import { formatDayMonth, formatDisplay, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { BackButton, transactionParent, useGoBack, useSheetHistory } from "../ui/back";
import { IconButton } from "../ui/icon-button";
import { CameraIcon, CheckIcon, ChevronDownIcon, CloseIcon, DocumentIcon, DownloadIcon, GoogleIcon, LogoutIcon, MoreIcon, PencilIcon, PlusIcon, ProjectsIcon, RefreshIcon, ReviewIcon, SearchIcon, SplitIcon, TagIcon, TrashIcon } from "../ui/icons";
import { BandFigures, BandHero, FigureLine, FormError, SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { CHANGE_SAVE_FAILURE, ChangeAssignment, changeSaveFailure, SHARED_SPLIT_FAILURE, type ChangeChoice } from "../ui/change-sheet";
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
  const preview = useHomePreview();
  const toast = useToast();
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
  const preview = useHomePreview();
  const toast = useToast();
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
  if (project.categories.length === 0 && !waiting) {
    return <p className="ui-page-pad t-hint">אין עדיין הוצאות מסווגות.</p>;
  }
  return (
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
  );
}

export function ProjectDetailScreen({ sample, example }: { sample?: NonNullable<ProjectDetail>; example?: ReactNode } = {}) {
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  const detail = useProjectQuery(sample ? "" : projectId);
  const preview = useHomePreview();
  const toast = useToast();
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
        categoryTo={sample?.id === "p1" ? `/e2e/project-category${search}` : undefined}
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
  const preview = useHomePreview();
  const toast = useToast();
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
    const waitingPhase = screenPhase(preview, waiting);
    if (waitingPhase.kind === "loading" || waitingPhase.kind === "error") {
      return <ScreenState title="לאישור" phase={waitingPhase} onRetry={() => { void waiting.refetch(); }} />;
    }
    const held = waiting.data ?? [];
    if (held.length === 0) return <ReviewEmpty search={search} filtered />;
    if (held.every((row) => row.review_id != null)) {
      if (phase.kind !== "ready") {
        return <ScreenState title="לאישור" phase={phase} onRetry={() => { void review.refetch(); }} />;
      }
      const ids = new Set(held.map((row) => row.review_id));
      const rows = (review.data ?? []).filter((row) => ids.has(row.id));
      if (rows.length === 0) return <ReviewEmpty search={search} filtered />;
      return <ReviewQueue rows={rows} search={search} />;
    }
    return <ProjectWaitingList rows={held} search={search} />;
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

function ProjectWaitingList({ rows, search }: { rows: ProjectWaitingRow[]; search: string }) {
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="הוצאות שמחכות לאישור בפרויקט הזה" />
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
            href={row.review_id == null
              ? `/transactions/${row.transaction_id}${search}`
              : `/review/change${search}${search ? "&" : "?"}item=${row.review_id}`}
          />
        ))}
      </List>
    </div>
  );
}

export function ReviewQueue({
  rows,
  search,
  sample = false,
  sampleSave,
  onSampleDone,
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
  /**
   * Reviewer preview only. ok toasts success and drops the row.
   * fail is a refusal with no retry. offline is a dropped connection.
   */
  sampleSave?: "ok" | "fail" | "offline";
  onSampleDone?: (id: string) => void;
  /** Reviewer preview sends שינוי to its own save screen. */
  changeTo?: string;
  /** Reviewer preview sends צפייה to its own filed list. */
  filedTo?: string;
  backTo?: string;
  /** Reviewer preview returns an empty queue to its index. */
  homeTo?: string;
  /** Label for that return. The product queue says לדף הבית. */
  homeLabel?: string;
  /** Reviewer preview opens its own split instead of the ledger split. */
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
  const visit = useRef({ total: rows.length, last: rows.length });
  if (rows.length > visit.current.last) {
    visit.current.total += rows.length - visit.current.last;
  }
  visit.current.last = rows.length;
  const row = rows[0];
  const leaving = motion === "out";
  useEffect(() => {
    const next = rows[0] ?? null;
    if (next?.id === shown?.id) return;
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
    failure: sampleSave ? changeSaveFailure : "לא הצלחנו לאשר.",
    success: sampleSave ? "הפריט אושר" : undefined,
    keys: ["review", "dashboard", "unpaid"],
    run: async () => {
      if (sampleSave) {
        await runSampleSave(sampleSave);
        return;
      }
      if (!row?.category_id) throw new Error("missing");
      if (row.direction !== "income" && !row.project_id) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
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
      if (sampleSave) {
        onSampleDone?.(row.id);
        return;
      }
      const id = row.id;
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
    failure: sampleSave ? changeSaveFailure : "לא הצלחנו לדלג.",
    success: "דילגנו על הפריט",
    keys: ["review"],
    run: async () => {
      if (sampleSave) {
        await runSampleSave(sampleSave);
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
      if (sampleSave && row) onSampleDone?.(row.id);
    },
  });
  const card = shown;
  if (!card) return <ReviewEmpty search={search} homeTo={homeTo} homeLabel={homeLabel} backTo={backTo} />;
  const change = changeTo ?? `/review/change${search}${search ? "&" : "?"}item=${card.id}`;
  const auto = card.auto_approved_today ?? 0;
  const suggestion = reviewSuggestion(card);
  const total = Math.max(visit.current.total, 1);
  const index = row ? total - rows.length + 1 : total;
  const approvable = !leaving && row != null && (row.reason === "unallocated_shared"
    ? row.transaction_id != null
    : row.direction === "income"
      ? row.category_id != null
      : row.project_id != null && row.category_id != null);
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
            if (!approvable || !row) return;
            if (sampleSave == null && blocked(sample ? "empty" : preview)) return;
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
              if (sampleSave == null && blocked(sample ? "empty" : preview)) return;
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
  if (!row.project_name && !row.category_name) return undefined;
  return {
    ...(row.project_name ? { project: row.project_name } : {}),
    ...(row.category_name ? { category: row.category_name } : {}),
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
    await invalidate(["review", "dashboard"]);
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

function ReviewEmpty({
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
        title={filtered ? "אין פריטים לפרויקט הזה" : "הכל מאושר"}
        body={filtered ? "אין פריטים של הפרויקט הזה בתור." : "אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."}
        action={<Button variant="pill" to={homeTo ?? `/${search}`}>{homeLabel ?? "לדף הבית"}</Button>}
      />
    </div>
  );
}

function runSampleSave(mode: "ok" | "fail" | "offline"): Promise<void> {
  if (mode === "fail") return Promise.reject(new Error("category kind must match the direction"));
  if (mode === "offline") return Promise.reject(new Error("Failed to fetch"));
  return Promise.resolve();
}

type CategorySample = {
  categoryName: string;
  projectName: string;
  rows: Array<{ id: string; description: string; doc_date: string; amount_net: bigint }>;
};

export function ProjectCategoryScreen({ sample }: { sample?: CategorySample } = {}) {
  const { projectId = "", categoryId = "" } = useParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const category = useProjectCategoryQuery(sample ? "" : projectId, sample ? "" : categoryId);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, category);
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
  const rows = sample?.rows ?? (category.data?.pages.flatMap((page) => page?.rows ?? []) ?? []);
  return (
    <div>
      <ScreenHeader title={name} subtitle={projectName} backTo={sample ? `/e2e/project-detail${search}` : back} />
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
              href={`/transactions/${txn.id}${search}`}
            />
          ))}
        </List>
      )}
      {sample || !category.hasNextPage ? null : (
        <div className="ui-page-pad">
          <Button
            variant="pill"
            busy={category.isFetchingNextPage}
            onClick={() => {
              void category.fetchNextPage();
            }}
          >
            עוד תנועות
          </Button>
        </div>
      )}
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
};

function withChoice(options: ChangeChoice[], id: string, name: string | null | undefined): ChangeChoice[] {
  if (id === "" || name == null || name === "" || options.some((option) => option.id === id)) return options;
  return [{ id, name }, ...options];
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
  const row = (review.data ?? []).find((entry) => entry.id === item);
  const [projectId, setProjectId] = useState(sample?.projectId ?? sample?.suggestionId ?? "");
  const [categoryId, setCategoryId] = useState(sample?.categoryId ?? sample?.suggestionCategoryId ?? "");
  const [remember, setRemember] = useState(true);
  const [extraProjects, setExtraProjects] = useState<ChangeChoice[]>([]);
  const seeded = useRef(false);
  const toasted = useRef(false);
  const phase = sample
    ? ({ kind: "ready" } as const)
    : combinePhase(combinePhase(screenPhase(preview, dashboard), screenPhase(preview, categories)), screenPhase(preview, review));
  const direction = sample?.direction ?? row?.direction ?? "expense";
  const formPhase = phase.kind === "ready" && sample == null && row == null ? ({ kind: "empty" } as const) : phase;
  const income = direction === "income";
  useEffect(() => {
    if (sample || !row || seeded.current) return;
    seeded.current = true;
    setProjectId(row.project_id ?? "");
    setCategoryId(row.category_id ?? "");
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
  const suggestionProjectId = sample?.suggestionId ?? row?.project_id ?? "";
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
    keys: ["review", "dashboard"],
    onSuccess: () => {
      void navigate(`/review${search}`);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || item === "") throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: item,
        p_action: "changed",
        ...(income ? {} : { p_project_id: projectId }),
        p_category_id: categoryId,
        p_remember: remember,
      }));
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
      {...(income ? {} : { remember, onRemember: setRemember })}
      saving={save.isPending}
      initialQuery={sample?.initialQuery}
      loading={sample?.loading}
      onSave={() => {
        if (sample) return;
        if (blocked()) return;
        if (row?.reason === "unallocated_shared" && row.transaction_id) {
          const transactionId = row.transaction_id;
          toast.show({
            tone: "info",
            message: SHARED_SPLIT_FAILURE,
            action: "לחלוקה",
            onAction: () => {
              void navigate(`/transactions/${transactionId}/split${search}`, { replace: true });
            },
          });
          return;
        }
        if (income ? categoryId === "" : projectId === "" || categoryId === "") {
          toast.show({ tone: "bad", message: income ? "בחרו קטגוריה." : "בחרו פרויקט וקטגוריה." });
          return;
        }
        save.mutate();
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
}: {
  sample?: NonNullable<TransactionDetail>;
  sampleProjects?: Array<{ id: string; name: string; code?: string }>;
  sampleCategories?: Array<{ id: string; name: string }>;
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
  const setChangeSheet = useSheetHistory("txn-change", changeOpen, setChangeOpen);
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
  useEffect(() => {
    if (changeOpen || !txn) return;
    setProjectId(txn.project_id ?? "");
    setCategoryId(txn.category_id ?? "");
  }, [changeOpen, txn]);
  const undoId = useRef<string | null>(null);
  const undo = useWrite({
    failure: "לא הצלחנו לבטל את השיוך.",
    keys: ["txn", "dashboard", "project", "review"],
    success: "השיוך הקודם חזר",
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || undoId.current == null) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_reassign", { p_id: undoId.current }));
    },
  });
  const reassign = useWrite({
    failure: changeSaveFailure,
    keys: ["txn", "dashboard", "project", "review"],
    onSuccess: () => {
      setChangeSheet(false);
      const id = undoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(!sample && id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
      });
    },
    run: async () => {
      const current = sample ?? detail.data;
      if (!current) throw new Error("supabase");
      const nextProject = [...(sampleProjects ?? []), ...extraProjects].find((project) => project.id === projectId);
      const nextCategory = (sampleCategories ?? []).find((category) => category.id === categoryId);
      if (sample) {
        if (nextProject) setProjectName(nextProject.name);
        if (nextCategory) setCategoryName(nextCategory.name);
        return;
      }
      const supabase = getSupabase();
      if (!supabase || projectId === "" && current.direction !== "income" || categoryId === "") throw new Error("supabase");
      const saved = await supabase.rpc("reassign_transaction", {
        p_id: current.id,
        p_project_id: current.direction === "income" ? (null as unknown as string) : projectId,
        p_category_id: categoryId,
      });
      assertNoError(saved);
      undoId.current = typeof saved.data === "string" ? saved.data : null;
    },
  });
  const setCategory = useWrite({
    failure: changeSaveFailure,
    keys: ["txn", "dashboard", "project", "review"],
    onSuccess: () => {
      setChangeSheet(false);
      const id = undoId.current;
      toast.show({
        message: "השיוך נשמר",
        ...(!sample && id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
      });
    },
    run: async () => {
      const current = sample ?? detail.data;
      if (!current) throw new Error("supabase");
      const nextCategory = (sampleCategories ?? []).find((category) => category.id === categoryId);
      if (sample) {
        if (nextCategory) setCategoryName(nextCategory.name);
        return;
      }
      const supabase = getSupabase();
      if (!supabase || categoryId === "") throw new Error("supabase");
      const saved = await supabase.rpc("set_transaction_category", {
        p_id: current.id,
        p_category_id: categoryId,
      });
      assertNoError(saved);
      undoId.current = typeof saved.data === "string" ? saved.data : null;
    },
  });
  if (phase.kind === "loading" || phase.kind === "error" || phase.kind === "empty") {
    return <ScreenState title="פרטי תנועה" backTo={parent} phase={phase.kind === "empty" ? { kind: "empty" } : phase} onRetry={() => { void detail.refetch(); }} empty={<p className="ui-page-pad t-hint">אין תנועה להצגה.</p>} />;
  }
  if (!txn) return <ScreenHeader title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={parent} />;
  const splitRow = txn.pnl_role === "shared" || txn.review_reason === "unallocated_shared" || (txn.allocations?.length ?? 0) > 1;
  const shownProject = splitProjectLabel(txn, splitRow, projectName || txn.project_name || "בלי פרויקט");
  const saveApproves = splitRow
    ? txn.review_status === "open" && txn.review_reason === "missing_category" && (txn.allocations?.length ?? 0) > 0
    : txn.review_status === "open";
  const shownCategory = categoryName || txn.category_name || "בלי קטגוריה";
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
            void navigate(`/transactions/${txn.id}/split${search}`);
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
        <Button variant="secondary" icon={<SplitIcon />} to={`/transactions/${txn.id}/split${search}`}>פיצול בין פרויקטים</Button>
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
        categoryOnly={splitRow}
        approves={saveApproves}
        saving={splitRow ? setCategory.isPending : reassign.isPending}
        loading={sample == null && (dashboard.isLoading || categories.isLoading)}
        onSave={() => {
          if (!sample && blocked()) return;
          if (splitRow) {
            if (categoryId === "") {
              toast.show({ tone: "bad", message: "בחרו קטגוריה." });
              return;
            }
            setCategory.mutate();
            return;
          }
          if (txn.direction === "income" ? categoryId === "" : projectId === "" || categoryId === "") {
            toast.show({ tone: "bad", message: txn.direction === "income" ? "בחרו קטגוריה." : "בחרו פרויקט וקטגוריה." });
            return;
          }
          reassign.mutate();
        }}
        onSplit={() => {
          setChangeOpen(false);
          void navigate(`/transactions/${txn.id}/split${search}`, { replace: true });
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

export function SplitScreen({
  sampleProjects,
  sampleAmount,
  sampleMeta,
  sampleMethod,
  sampleShares,
  sampleChosen,
  sampleSaving = false,
  onSave,
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
  onSave?: (rows: Array<{ project_id: string; share_bp: number }>) => void;
  example?: ReactNode;
  /** Where back goes when this screen was opened directly. */
  backTo?: string;
} = {}) {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const goBack = useGoBack();
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
  const [method, setMethod] = useState<SplitMethod | null>(sampleMethod === undefined ? null : sampleMethod);
  const [chosen, setChosen] = useState<string[]>(sampleChosen ?? []);
  const [manual, setManual] = useState<Record<string, string>>(sampleShares ?? {});
  const [detail, setDetail] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const manualEdited = useRef(sampleShares != null);
  const priorMethod = useRef<SplitMethod | null>(sampleMethod === "manual" ? null : (sampleMethod ?? null));
  const rowsRef = useRef<Array<{ project_id: string; share_bp: number }>>([]);
  const fallback = backTo ?? `/transactions/${transactionId}${search}`;
  const activeKey = active.map((project) => `${project.id}:${project.incomeAgorot ?? 0n}`).join("|");
  useEffect(() => {
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
          : false;
  rowsRef.current = sharesForSave(valid ? parts : []);
  const save = useWrite({
    failure: () => "החלוקה לא נשמרה",
    success: "החלוקה נשמרה",
    keys: ["dashboard", "txn", "project"],
    onSuccess: () => {
      goBack(fallback);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("save_split", { p_transaction_id: transactionId, p_shares: rowsRef.current }));
    },
  });
  const busy = sampleSaving || save.isPending;
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
  const summary = !method
    ? "בחרו איך לחלק"
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
  return (
    <form
      className="ui-split"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        if (onSave) {
          onSave(rowsRef.current);
          return;
        }
        if (sampleProjects) return;
        if (blocked()) return;
        save.mutate();
      }}
    >
      <ScreenHeader
        layout="stacked"
        title="חלוקה בין פרויקטים"
        leading={<BackButton label="סגירה" fallback={fallback} disabled={busy}><CloseIcon /></BackButton>}
        trailing={example}
      />
      <div className="ui-split-amount">
        <p className="t-title-1"><BigNumber agorot={amount} presentation="detail" /></p>
        {meta ? <p className="ui-split-meta t-label">{meta}</p> : null}
      </div>
      <h2 className="ui-split-question t-title-3">איך לחלק?</h2>
      <fieldset className="ui-split-body" disabled={busy}>
        <div className="ui-split-card" role="radiogroup" aria-label="איך לחלק?">
          <RadioRow marker="start" label="שווה בין כל הפרויקטים" description={allLine} selected={method === "equal"} onSelect={() => { setMethod("equal"); }} />
          <RadioRow marker="start" label="שווה בין פרויקטים שאבחר" description={chosenLine} selected={method === "chosen"} onSelect={() => { setMethod("chosen"); }} />
          <RadioRow
            marker="start"
            label="לפי הכנסות"
            description={hasIncome ? "לפי ההכנסות של כל פרויקט בתקופה" : undefined}
            disabledReason={hasIncome ? undefined : "אין הכנסות בתקופה הזו"}
            selected={method === "income"}
            onSelect={() => { setMethod("income"); }}
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
        <p className={summaryIdle ? "ui-split-summary t-body ui-split-summary-idle" : "ui-split-summary t-body"}>
          {method === "manual" && manualLeft < 0 ? (
            <>
              {"הסך "}
              <bdi className="ui-split-bad" dir="ltr">{`${percentWords(manualUsed)}%`}</bdi>
              {". צריך 100%."}
            </>
          ) : summary}
        </p>
        <Button type="submit" full disabled={!valid} busy={busy}>{busy ? "שומר…" : "שמירה"}</Button>
      </div>
    </form>
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
};

export function SettingsScreen({
  sample,
}: {
  sample?: SettingsSample;
} = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const { session } = useAuth();
  const toast = useToast();
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
  const vatRegistered = sample ? sample.vatRegistered : dashboard.data?.vat_registered !== false;
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
  const projectCount = sample?.projectCount ?? dashboard.data?.projects.length;
  const expenseCount = sample?.expenseCategories ?? categories.data?.filter((category) => category.kind === "expense" && !category.hidden).length;
  const incomeCount = sample?.incomeCategories ?? categories.data?.filter((category) => category.kind === "income" && !category.hidden).length;
  const categoryHint = expenseCount == null || incomeCount == null
    ? undefined
    : `${String(expenseCount)} הוצאות · ${String(incomeCount)} הכנסות`;
  return (
    <div>
      <ScreenHeader title="הגדרות" />
      <SectionHead title="החברה" />
      <List>
        {emptyAccount ? (
          <ListRow variant="static" title="חשבון Google" hint={email ? <bdi dir="ltr">{email}</bdi> : "החשבון"} icon={<GoogleIcon />} />
        ) : (
          <ListRow variant="static" title={businessName ?? "עדיין בלי עסק"} hint={vatRegistered ? "עוסק מורשה" : "עוסק פטור"} icon={<ProjectsIcon />} />
        )}
        {!emptyAccount && email ? <ListRow variant="static" title="חשבון Google" hint={<bdi dir="ltr">{email}</bdi>} icon={<GoogleIcon />} /> : null}
      </List>
      <SectionHead title="חיבור SUMIT" />
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
      {emptyAccount ? (
        <List>
          <ListRow
            variant="danger"
            title="התנתקות"
            icon={<LogoutIcon />}
            busy={signOut.isPending}
            onClick={() => {
              if (blocked()) return;
              signOut.mutate();
            }}
          />
        </List>
      ) : (
      <>
      <SectionHead title="סיווג" />
      <List>
        <ListRow variant="item" href={`/settings/categories${search}`} title="קטגוריות" hint={categoryHint} icon={<TagIcon />} chevron />
        <ListRow variant="item" href={`/projects${search}`} title="פרויקטים" hint={projectCount == null ? undefined : `${String(projectCount)} פעילים`} icon={<ProjectsIcon />} chevron />
      </List>
      <SectionHead title="התראות" />
      <div className="ui-page-pad">
        <Toggle label="סיכום שבועי" hint="לא פעיל" checked={false} disabled onChange={() => undefined} />
        <Toggle label="תזכורת לפריטים ממתינים" hint="לא פעיל" checked={false} disabled onChange={() => undefined} />
      </div>
      <SectionHead title="אישור ותצוגה" />
      <div className="ui-page-pad">
        <Toggle label="אישור אוטומטי בביטחון גבוה" hint="לא פעיל" checked={false} disabled onChange={() => undefined} />
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
      <SectionHead title="נתונים" />
      <List>
        {preview === "off" ? (
          <ListRow
            variant="danger"
            title="התנתקות"
            icon={<LogoutIcon />}
            busy={signOut.isPending}
            onClick={() => { signOut.mutate(); }}
          />
        ) : null}
      </List>
      </>
      )}
      {isStandalone() ? null : (
        <>
          <SectionHead title="אפליקציה" />
          <List>
            <ListRow variant="item" href={`/install${search}`} title="התקנה למסך הבית" hint="נפתח כמו אפליקציה" icon={<DownloadIcon />} chevron />
          </List>
        </>
      )}
      <p className="ui-poc t-hint"><bdi dir="ltr">Flow · POC 0.1</bdi></p>
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
  const toast = useToast();
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
