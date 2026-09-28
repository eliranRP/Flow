import { formatIls, shekelsToAgorot, type CategoryRow, type Dashboard, type ProjectDetail, type ReviewRow, type TransactionDetail, type UnpaidRow } from "@flow/shared";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { absAgorot } from "../agorot";
import { overheadHint, shownProfit } from "../overhead";
import { useAuth } from "../auth";
import { addTriggerRef } from "../add-trigger";
import { getSupabase } from "../lib/supabase";
import { periodLabel } from "../period";
import { useHomePreview, usePreviewSearch, type HomePreview } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { withSheetBackground } from "../sheet-background";
import { hebrewSumitError, retryClock } from "../sumit-copy";
import { isStandalone } from "../ui/install-prompt";
import {
  useBooks,
  useCategoriesQuery,
  useDashboardQuery,
  useInvalidateBooks,
  useProjectQuery,
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
  if (!(error instanceof FunctionsHttpError)) {
    return error instanceof Error ? error.message : "connect_failed";
  }
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
import { Chip, StatusPill } from "../ui/chip";
import { formatDayMonth, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { BackIcon, CameraIcon, CheckIcon, ChevronDownIcon, CloseIcon, DocumentIcon, DownloadIcon, GoogleIcon, LogoutIcon, MoreIcon, PencilIcon, PlusIcon, ProjectsIcon, RefreshIcon, ReviewIcon, SearchIcon, SplitIcon, TagIcon, TrashIcon } from "../ui/icons";
import { BandFigures, BandHero, FigureLine, FormError, SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { CHANGE_SAVE_FAILURE, ChangeAssignment, type ChangeChoice } from "../ui/change-sheet";
import { MoneyField, PercentField } from "../ui/money-field";
import { BudgetBar, ProgressBar } from "../ui/progress-bar";
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

export function OnboardingScreen() {
  const navigate = useNavigate();
  const preview = useHomePreview();
  const toast = useToast();
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
    if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
      <ScreenHeader title="פרטי העסק" subtitle="השם שיופיע בבית." />
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
        body="פרויקטים מגיעים מ-SUMIT, ואפשר גם לפתוח אחד כאן."
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
    if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
          <IconButton label="חזרה" to={`/projects${search}`} onBand>
            <BackIcon />
          </IconButton>
        }
        trailing={
          <IconButton label="עוד" onBand onClick={() => { setMenu(true); }}>
            <MoreIcon />
          </IconButton>
        }
      >
        <BandHero>
          <div className="ui-skel-stack">
            <Skeleton tone="band" className="ui-skel-label" />
            <Skeleton tone="band" className="ui-skeleton-hero ui-skel-hero-num" />
            <span className="ui-skel-figures">
              <Skeleton tone="band" className="ui-skel-figure" />
              <Skeleton tone="band" className="ui-skel-figure" />
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

export function ProjectDetailScreen({ sample, example }: { sample?: NonNullable<ProjectDetail>; example?: ReactNode } = {}) {
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  const detail = useProjectQuery(sample ? "" : projectId);
  const preview = useHomePreview();
  const toast = useToast();
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
          <IconButton label="חזרה" to={`/projects${search}`} onBand>
            <BackIcon />
          </IconButton>
        }
        trailing={<ProjectMenu projectId={project.id} name={project.name} budget={project.budget_agorot ?? null} finished={project.status === "finished"} />}
      >
        <BandHero>
          <h1 className="t-title-2">{project.name}</h1>
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
            if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
      {project.categories.length === 0 ? <p className="ui-page-pad t-hint">אין עדיין הוצאות מסווגות.</p> : (
        <List>
          {project.categories.map((category) => (
            <ListRow
              key={category.id ?? category.name}
              variant="project"
              title={category.name ?? "בלי קטגוריה"}
              agorot={absAgorot(category.amount_agorot)}
              loss={false}
            />
          ))}
        </List>
      )}
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
          <IconButton label="חזרה" to={`/projects${search}`} onBand>
            <BackIcon />
          </IconButton>
        }
      >
        <BandHero>
          <h1 className="t-title-2">פרויקט</h1>
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
          if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
          save.mutate();
        }}
      />
    </>
  );
}

export function ReviewScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const review = useReviewQuery();
  const phase = screenPhase(preview, review);
  if (phase.kind === "empty") return <ReviewEmpty search={search} />;
  if (phase.kind !== "ready") {
    return <ScreenState title="לאישור" phase={phase} onRetry={() => { void review.refetch(); }} />;
  }
  return <ReviewQueue rows={review.data ?? []} search={search} />;
}

export function ReviewQueue({
  rows,
  search,
  sample = false,
}: {
  rows: ReviewRow[];
  search: string;
  sample?: boolean;
}) {
  const preview = useHomePreview();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const [hideAuto, setHideAuto] = useState(false);
  const row = rows[0];
  const approve = useWrite({
    failure: "לא הצלחנו לאשר.",
    keys: ["review", "dashboard", "unpaid"],
    run: async () => {
      if (!row?.category_id) throw new Error("missing");
      if (row.direction !== "income" && !row.project_id) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: row.id,
        p_action: "approved",
        ...(row.direction === "income" || row.project_id == null ? {} : { p_project_id: row.project_id }),
        p_category_id: row.category_id,
      }));
    },
    onSuccess: () => {
      if (!row) return;
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
    failure: "לא הצלחנו לדלג.",
    success: "דילגנו על הפריט",
    keys: ["review"],
    run: async () => {
      if (!row) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: row.id,
        p_action: "skipped",
      }));
    },
  });
  if (!row) return <ReviewEmpty search={search} />;
  const change = `/review/change${search}${search ? "&" : "?"}item=${row.id}`;
  const auto = row.auto_approved_today ?? 0;
  const suggestion = reviewSuggestion(row);
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" />
      <div className="ui-review-meter">
        <ProgressBar
          variant="thin"
          label="התקדמות התור"
          value={1}
          max={rows.length}
          caption={
            <span className="t-hint">
              <bdi dir="ltr">1</bdi> מתוך <bdi dir="ltr">{String(rows.length)}</bdi>
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
              <TextLink to={`/review${search}`}>צפייה</TextLink>
              <IconButton label="סגירה" onClick={() => { setHideAuto(true); }}>
                <CloseIcon />
              </IconButton>
            </>
          }
        />
      ) : null}
      <ReviewCard
        supplier={row.supplier_name ?? row.description}
        sourceLine={`${docKindLabel(row.doc_kind)} · ${invoiceDate(row.doc_date)}`}
        netAgorot={row.amount_net}
        vatLine={reviewVatLine(row.vat_agorot)}
        suggestion={suggestion}
      />
      <div className="ui-review-actions">
        <Button
          full
          busy={approve.isPending}
          onClick={() => {
            if (sample || blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
            if (row.reason === "unallocated_shared") {
              if (row.transaction_id) void navigate(`/transactions/${row.transaction_id}/split${search}`);
              return;
            }
            if (row.direction === "income" ? !row.category_id : !row.project_id || !row.category_id) {
              toast.show({ tone: "bad", message: row.direction === "income" ? "בלי קטגוריה אי אפשר לאשר. בחרו בשינוי." : "בלי פרויקט וקטגוריה אי אפשר לאשר. בחרו בשינוי." });
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
            onClick={() => {
              if (sample || blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
    ...(row.confidence == null ? {} : { confidence: row.confidence }),
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

function ReviewEmpty({ search }: { search: string }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="לאישור" subtitle="מסמכים שמחכים לשיוך" />
      <EmptyState
        icon={<ReviewIcon />}
        title="הכל מאושר"
        body="אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."
        action={<Button variant="pill" to={`/${search}`}>לדף הבית</Button>}
      />
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
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const navigate = useNavigate();
  const toast = useToast();
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
    failure: CHANGE_SAVE_FAILURE,
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
    if (sample) {
      const created = { id: `draft:${name}`, name, status: "active" as const };
      setExtraProjects((list) => [...list, created]);
      return created;
    }
    if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) throw new Error("preview");
    const supabase = getSupabase();
    if (!supabase) throw new Error("supabase");
    try {
      const saved = await supabase.rpc("upsert_project", { p_name: name, p_status: "active" });
      assertNoError(saved);
      if (typeof saved.data !== "string") throw new Error("supabase");
      const created = { id: saved.data, name, status: "active" as const };
      setExtraProjects((list) => [...list, created]);
      await invalidate(["dashboard"]);
      toast.show({ message: "הפרויקט נשמר" });
      return created;
    } catch (error) {
      if (error instanceof Error && error.message === "preview") throw error;
      toast.show({ tone: "bad", message: "לא הצלחנו לשמור את הפרויקט." });
      throw error;
    }
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
        if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
      <Button variant="ghost" full to={`/${search}`}>ביטול</Button>
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
        <p className="t-label">השורה תצא מהרשימה כש-SUMIT יראה את החשבונית כשולמה בסנכרון הבא. Flow לא מסמן תשלום ב-SUMIT.</p>
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
  const invalidate = useInvalidateBooks();
  const [confirm, setConfirm] = useState(false);
  const [menu, setMenu] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
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
    failure: CHANGE_SAVE_FAILURE,
    keys: ["txn", "dashboard", "project", "review"],
    onSuccess: () => {
      setChangeOpen(false);
      const id = undoId.current;
      if (sample) return;
      toast.show({
        message: "השיוך נשמר",
        ...(id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
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
    failure: CHANGE_SAVE_FAILURE,
    keys: ["txn", "dashboard", "project", "review"],
    onSuccess: () => {
      setChangeOpen(false);
      const id = undoId.current;
      if (sample) return;
      toast.show({
        message: "השיוך נשמר",
        ...(id ? { action: "ביטול", onAction: () => { undo.mutate(); } } : {}),
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
    return <ScreenState title="פרטי תנועה" backTo={`/${search}`} phase={phase.kind === "empty" ? { kind: "empty" } : phase} onRetry={() => { void detail.refetch(); }} empty={<p className="ui-page-pad t-hint">אין תנועה להצגה.</p>} />;
  }
  if (!txn) return <ScreenHeader title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={`/${search}`} />;
  const allocationCount = txn.allocations?.length ?? 0;
  const splitRow = txn.pnl_role === "shared" || txn.review_reason === "unallocated_shared" || allocationCount > 1;
  const shownProject = splitRow
    ? `מפוצל · ${String(allocationCount)} פרויקטים`
    : projectName || txn.project_name || "בלי פרויקט";
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
        leading={<IconButton label="חזרה" to={`/${search}`}><BackIcon /></IconButton>}
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
          setChangeOpen(true);
        }} />
        <ListRow variant="button" eyebrow="קטגוריה" title={shownCategory} icon={<TagIcon />} chevron onClick={() => { setChangeOpen(true); }} />
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
        onOpenChange={setChangeOpen}
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
        saving={splitRow ? setCategory.isPending : reassign.isPending}
        loading={sample == null && (dashboard.isLoading || categories.isLoading)}
        onSave={() => {
          if (!sample && blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
          void navigate(`/transactions/${txn.id}/split${search}`);
        }}
        onCreateProject={async (name) => {
          if (sample) {
            const created = { id: `draft:${name}`, name, status: "active" as const };
            setExtraProjects((list) => [...list, created]);
            return created;
          }
          if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) throw new Error("preview");
          const supabase = getSupabase();
          if (!supabase) throw new Error("supabase");
          try {
            const saved = await supabase.rpc("upsert_project", { p_name: name, p_status: "active" });
            assertNoError(saved);
            if (typeof saved.data !== "string") throw new Error("supabase");
            const created = { id: saved.data, name, status: "active" as const };
            setExtraProjects((list) => [...list, created]);
            await invalidate(["dashboard"]);
            toast.show({ message: "הפרויקט נשמר" });
            return created;
          } catch (error) {
            if (!(error instanceof Error) || error.message !== "preview") {
              toast.show({ tone: "bad", message: "לא הצלחנו לשמור את הפרויקט." });
            }
            throw error;
          }
        }}
      />
      <Sheet open={menu} onOpenChange={setMenu} title="עוד">
        {txn.source === "manual" ? (
          <Button variant="danger" icon={<TrashIcon />} onClick={() => { setMenu(false); setConfirm(true); }}>מחיקה</Button>
        ) : (
          <p className="t-hint">תנועה מ-SUMIT לא נמחקת כאן. היא מתעדכנת בסנכרון.</p>
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
          if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
          remove.mutate();
        }}
      />
    </div>
  );
}

type SplitProject = { id: string; name: string; incomeAgorot?: bigint };
type SplitMethod = "equal" | "income" | "manual";

function sharePercent(bp: number): string {
  const whole = bp / 100;
  return Number.isInteger(whole) ? `${String(whole)}%` : `${whole.toFixed(1)}%`;
}

function evenShares(projects: SplitProject[]): Record<string, number> {
  if (projects.length === 0) return {};
  const base = Math.floor(10000 / projects.length);
  let used = 0;
  const shares: Record<string, number> = {};
  projects.forEach((project, index) => {
    const bp = index === projects.length - 1 ? 10000 - used : base;
    shares[project.id] = bp;
    used += bp;
  });
  return shares;
}

function incomeShares(projects: SplitProject[]): Record<string, number> {
  const total = projects.reduce((sum, project) => sum + (project.incomeAgorot ?? 0n), 0n);
  if (total <= 0n) return evenShares(projects);
  let used = 0;
  const shares: Record<string, number> = {};
  projects.forEach((project, index) => {
    if (index === projects.length - 1) {
      shares[project.id] = 10000 - used;
      return;
    }
    const bp = Number(((project.incomeAgorot ?? 0n) * 10000n) / total);
    shares[project.id] = bp;
    used += bp;
  });
  return shares;
}

export function SplitScreen({
  sampleProjects,
  sampleAmount,
  sampleContext,
  sampleMethod,
  sampleShares,
  example,
}: {
  sampleProjects?: SplitProject[];
  sampleAmount?: bigint;
  sampleContext?: string;
  sampleMethod?: SplitMethod;
  /** Manual percents, as typed. Stories use this to open partly filled. */
  sampleShares?: Record<string, string>;
  example?: ReactNode;
} = {}) {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const toast = useToast();
  const dashboard = useDashboardQuery(sampleProjects == null);
  const txn = useTransactionQuery(sampleProjects ? "" : transactionId);
  const phase = sampleProjects ? ({ kind: "ready" } as const) : combinePhase(screenPhase(preview, dashboard), screenPhase(preview, txn));
  const projects: SplitProject[] = sampleProjects ?? (dashboard.data?.projects ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    incomeAgorot: project.income_agorot,
  }));
  const [method, setMethod] = useState<SplitMethod>(sampleMethod ?? "income");
  const [manual, setManual] = useState<Record<string, string>>(sampleShares ?? {});
  const [seeded, setSeeded] = useState(false);
  const remainRef = useRef<HTMLDivElement>(null);
  const [scrolledUnder, setScrolledUnder] = useState(false);
  useEffect(() => {
    if (seeded || !txn.data?.allocations) return;
    const next: Record<string, string> = {};
    for (const row of txn.data.allocations) next[row.project_id] = String(row.share_bp / 100);
    setManual(next);
    setMethod("manual");
    setSeeded(true);
  }, [seeded, txn.data]);
  useEffect(() => {
    const node = remainRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      setScrolledUnder(entry ? !entry.isIntersecting : false);
    }, { rootMargin: "0px 0px -88px 0px" });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [phase.kind, projects.length]);
  const amount = sampleAmount ?? absAgorot(txn.data?.amount_net ?? 0n);
  const context = sampleContext ?? txn.data?.description ?? "התנועה";
  const shares = method === "manual"
    ? Object.fromEntries(projects.map((project) => [project.id, Math.round((Number(manual[project.id]) || 0) * 100)]))
    : method === "income"
      ? incomeShares(projects)
      : evenShares(projects);
  const used = Object.values(shares).reduce((sum, value) => sum + value, 0);
  const left = 10000 - used;
  const save = useWrite({
    failure: (error) => (error.message.includes("10000") ? "החלקים צריכים להסתכם ב-100%." : "לא הצלחנו לשמור את הפיצול."),
    success: "הפיצול נשמר",
    keys: ["dashboard", "txn", "project"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const rows = Object.entries(shares)
        .filter(([, value]) => value > 0)
        .map(([project, value]) => ({ project_id: project, share_bp: value }));
      assertNoError(await supabase.rpc("save_split", { p_transaction_id: transactionId, p_shares: rows }));
    },
  });
  if (phase.kind !== "ready" || projects.length === 0) {
    return (
      <ScreenState
        title="פיצול בין פרויקטים"
        backTo={`/transactions/${transactionId}${search}`}
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        onRetry={() => { void dashboard.refetch(); void txn.refetch(); }}
        empty={<EmptyState icon={<ProjectsIcon />} title="אין פרויקטים לפיצול" body="פיצול מחכה לפרויקט אחד לפחות." />}
      />
    );
  }
  const incomeMissing = method === "income" && projects.every((project) => (project.incomeAgorot ?? 0n) <= 0n);
  const balanced = left === 0;
  const remainder = amount * BigInt(Math.abs(left)) / 10000n;
  return (
    <form
      className="ui-split"
      onSubmit={(event) => {
        event.preventDefault();
        if (sampleProjects || !balanced) return;
        if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
        save.mutate();
      }}
    >
      <ScreenHeader
        barOnly
        leading={<IconButton label="סגירה" to={`/transactions/${transactionId}${search}`}><CloseIcon /></IconButton>}
        trailing={example}
      />
      <div className="ui-split-title">
        <h1 className="t-title-1">פיצול בין פרויקטים</h1>
        <p className="ui-split-context t-label">{context}</p>
      </div>
      <p className="ui-page-pad ui-split-amount t-title-2"><BigNumber agorot={amount} /></p>
      <div className="ui-page-pad ui-split-method">
        <SegmentedControl
          label="אופן הפיצול"
          showLabel={false}
          radius="input"
          wrap
          value={method}
          onChange={setMethod}
          options={[
            { value: "equal", label: "שווה בשווה" },
            { value: "income", label: "לפי הכנסות" },
            { value: "manual", label: "ידני" },
          ]}
        />
      </div>
      <div className="ui-page-pad ui-split-scope">
        <Chip kind="selected" className="ui-chip-scope">
          כל הפרויקטים הפעילים · <bdi className="ui-num">{String(projects.length)}</bdi>
        </Chip>
      </div>
      {incomeMissing ? <p className="ui-page-pad ui-split-note t-hint">אין עדיין משקלות הכנסה, אז החלוקה שווה.</p> : null}
      <List className="ui-split-list">
        {projects.map((project) => {
          const bp = shares[project.id] ?? 0;
          const part = amount * BigInt(bp) / 10000n;
          return (
            <ListRow
              key={project.id}
              variant="static"
              title={project.name}
              hint={method === "income" ? <>הכנסות החודש <bdi className="ui-num" dir="ltr">{formatIls(project.incomeAgorot ?? 0n)}</bdi></> : undefined}
              meta={method === "manual" ? (
                <PercentField
                  hideLabel
                  label={`אחוז, ${project.name}`}
                  value={manual[project.id] ?? ""}
                  onValueChange={(raw) => { setManual({ ...manual, [project.id]: raw }); }}
                />
              ) : (
                <span className="ui-split-share">
                  <bdi className="ui-num ui-split-figure" dir="ltr">{formatIls(part)}</bdi>
                  <bdi className="ui-num t-hint" dir="ltr">{sharePercent(bp)}</bdi>
                </span>
              )}
            />
          );
        })}
      </List>
      <div className={balanced ? "ui-page-pad ui-split-remain ui-split-balanced" : "ui-page-pad ui-split-remain"} ref={remainRef}>
        <FigureLine
          label="נותר לשייך"
          value={balanced ? `100% · ${formatIls(0n)} ✓` : formatIls(remainder)}
        />
      </div>
      <div className={scrolledUnder ? "ui-split-cta ui-split-cta-under" : "ui-split-cta"}>
        <Button type="submit" full disabled={!balanced} busy={save.isPending}>שמירת פיצול</Button>
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
  const status = useSumitStatusQuery(sample == null);
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [overheadOn, setOverheadOn] = useState(false);
  const wantedOverhead = useRef(false);
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
    failure: (error) => hebrewSumitError(error.message) ?? "החיבור נכשל. בדקו את המזהה ואת המפתח.",
    success: "SUMIT מחובר. המפתח נשאר בשרת.",
    keys: ["sumit", "dashboard"],
    onSuccess: () => {
      setApiKey("");
      setConnectOpen(false);
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
    onSuccess: () => { setDisconnectOpen(false); },
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
  const retryHint = rawError === "sumit_auth" ? null : retryClock(sample ? sample.nextAttemptAt : status.data?.next_attempt_at);
  const refreshHeld = rawError === "sumit_auth" || retryHint != null;
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
          <ListRow variant="button" title="חיבור SUMIT" hint="מספר חברה ומפתח API" icon={<RefreshIcon />} chevron onClick={() => { setConnectOpen(true); }} />
        )}
        {connected ? (
          <ListRow
            variant="button"
            title="רענון עכשיו"
            hint={retryHint ?? undefined}
            icon={<RefreshIcon />}
            chevron
            busy={refresh.isPending}
            disabled={refreshHeld}
            onClick={() => {
              if (refreshHeld) return;
              if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
              refresh.mutate();
            }}
          />
        ) : null}
        {connected ? (
          <ListRow variant="danger" title="ניתוק" icon={<LogoutIcon />} onClick={() => { setDisconnectOpen(true); }} />
        ) : null}
      </List>
      {lastError && !emptyAccount ? <div className="ui-page-pad"><FormError>{lastError}</FormError></div> : null}
      {rawError === "sumit_auth" && !emptyAccount ? (
        <div className="ui-page-pad">
          <Button variant="secondary" onClick={() => { setConnectOpen(true); }}>חיבור מחדש</Button>
        </div>
      ) : null}
      <Sheet open={connectOpen} onOpenChange={setConnectOpen} title="חיבור SUMIT">
        <form
          className="ui-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
        onOpenChange={setDisconnectOpen}
        title="לנתק את SUMIT?"
        consequence="המפתח נמחק. הספרים שכבר ירדו נשארים."
        confirmLabel="ניתוק"
        destructive
        busy={disconnect.isPending}
        onConfirm={() => {
          if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
              if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
            if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
              if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
          if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
          if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
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
