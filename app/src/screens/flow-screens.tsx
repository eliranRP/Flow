import { formatIls, shekelsToAgorot, type CategoryRow, type Dashboard, type ProjectDetail, type ReviewRow, type UnpaidRow } from "@flow/shared";
import { useState, type SubmitEvent } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { addTriggerRef } from "../add-trigger";
import { getSupabase } from "../lib/supabase";
import { periodLabel } from "../period";
import { useHomePreview, usePreviewSearch, type HomePreview } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { withSheetBackground } from "../sheet-background";
import { hebrewSumitError } from "../sumit-copy";
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
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { formatDayMonth } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { BackIcon, CameraIcon, DocumentIcon, ProjectsIcon, ReviewIcon, SearchIcon, TrashIcon } from "../ui/icons";
import { BandHero, FormError, Section } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { MoneyField } from "../ui/money-field";
import { BudgetBar } from "../ui/progress-bar";
import { ReviewCard } from "../ui/review-card";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SearchField } from "../ui/search-field";
import { SegmentedControl } from "../ui/segmented-control";
import { SelectField } from "../ui/select-field";
import { Sheet } from "../ui/sheet";
import { RouteSheet } from "../ui/route-sheet";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { TopBand } from "../ui/top-band";

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

  return (
    <main>
      <ScreenHeader title="פרטי העסק" subtitle="השם שיופיע בבית, ומצב המע״מ." />
      <form className="ui-stack ui-page-pad" onSubmit={submit}>
        <TextField label="שם העסק" value={name} onChange={(event) => { setName(event.target.value); }} required minLength={2} />
        <SegmentedControl
          label="מצב מע״מ"
          value={vat}
          onChange={setVat}
          options={[
            { value: "registered", label: "עוסק מורשה, 18%" },
            { value: "exempt", label: "עוסק פטור" },
          ]}
        />
        <Button type="submit" busy={save.isPending}>המשך</Button>
      </form>
    </main>
  );
}

export function ProjectsScreen({ sample }: { sample?: Dashboard } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const dashboard = useDashboardQuery();
  const books = useBooks();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const phase: ScreenPhase = sample ? { kind: "ready" } : screenPhase(preview, dashboard);
  const data = sample ?? dashboard.data;
  const empty = (
    <>
      <ScreenHeader title="פרויקטים" />
      <EmptyState
        icon={<ProjectsIcon />}
        title="עוד אין פרויקטים"
        body="פרויקטים נפתחים מעצמם כשמזהים לקוח חוזר בדוח הבנק. אפשר גם לפתוח ידנית."
        action={<Button variant="pill" onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
      />
      <Sheet open={open} onOpenChange={setOpen} title="פרויקט">
        <ProjectForm onClose={() => { setOpen(false); }} />
      </Sheet>
    </>
  );
  if (phase.kind === "empty" || (phase.kind === "ready" && (data?.projects.length ?? 0) === 0)) return empty;
  return (
    <ScreenState
      title="פרויקטים"
      subtitle={data ? `${String(data.projects.filter((project) => project.status === "active").length)} פעילים · רווח ${periodLabel(books.period)}` : undefined}
      phase={phase}
      onRetry={() => { void dashboard.refetch(); }}
    >
      <ProjectsBody
        projects={data?.projects ?? []}
        query={query}
        setQuery={setQuery}
        expanded={expanded}
        setExpanded={setExpanded}
        search={search}
        open={open}
        setOpen={setOpen}
      />
    </ScreenState>
  );
}

function ProjectsBody({
  projects,
  query,
  setQuery,
  expanded,
  setExpanded,
  search,
  open,
  setOpen,
}: {
  projects: Dashboard["projects"];
  query: string;
  setQuery: (value: string) => void;
  expanded: boolean;
  setExpanded: (value: boolean) => void;
  search: string;
  open: boolean;
  setOpen: (value: boolean) => void;
}) {
  const finished = projects.filter((project) => project.status === "finished");
  const active = projects.filter((project) => project.status !== "finished");
  const shown = expanded ? projects : active.slice(0, 6);
  const restActive = Math.max(0, active.length - 6);
  const needle = query.trim();
  const visible = shown.filter((project) => needle === "" || project.name.includes(needle));
  return (
    <>
      <div className="ui-page-pad ui-stack">
        <Button variant="pill" onClick={() => { setOpen(true); }}>פרויקט חדש</Button>
        <SearchField label="חיפוש פרויקט" value={query} onChange={setQuery} />
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={`לא מצאנו ״${needle}״`}
          body="אפשר לחפש לפי שם הפרויקט, הלקוח או הקוד (P-12). גם פרויקטים שהסתיימו נכללים."
          action={<Button variant="pill" onClick={() => { setQuery(""); }}>ניקוי החיפוש</Button>}
        />
      ) : (
        <List>
          {visible.map((project) => (
            <ListRow
              key={project.id}
              variant="project"
              title={project.name}
              hint={project.status === "finished" ? "הסתיים" : "פעיל"}
              agorot={project.profit_agorot}
              loss={project.profit_agorot < 0n}
              href={`/projects/${project.id}${search}`}
            />
          ))}
        </List>
      )}
      {!expanded && needle === "" && (restActive > 0 || finished.length > 0) ? (
        <p className="ui-page-pad">
          <button type="button" className="ui-text-link ui-text-link-quiet" onClick={() => { setExpanded(true); }}>
            <bdi dir="ltr">{`עוד ${String(restActive)} פעילים · ${String(finished.length)} הסתיימו`}</bdi>
          </button>
        </p>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen} title="פרויקט">
        <ProjectForm onClose={() => { setOpen(false); }} />
      </Sheet>
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
        p_id: (projectId ?? null) as unknown as string,
        p_name: name,
        p_budget_agorot: (agorot ?? null) as unknown as number,
        p_status: "active",
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

export function ProjectDetailScreen({ sample }: { sample?: NonNullable<ProjectDetail> } = {}) {
  const preview = useHomePreview();
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  const detail = useProjectQuery(sample ? "" : projectId);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  if (phase.kind === "empty") return <LegacyEmptyProject />;
  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState title="פרויקט" backTo={`/projects${search}`} phase={phase} onRetry={() => { void detail.refetch(); }} />
    );
  }
  const project = sample ?? detail.data;
  if (!project) {
    return <ScreenHeader title="פרויקט" subtitle="הפרויקט לא נמצא." backTo={`/projects${search}`} />;
  }
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        trailing={
          <IconButton label="חזרה" to={`/projects${search}`} onBand>
            <BackIcon />
          </IconButton>
        }
      >
        <BandHero>
          <h1 className="t-title-2">{project.name}</h1>
          <p className="ui-band-label t-label">{project.state_label ?? (project.status === "finished" ? "הסתיים" : "פעיל")}</p>
          <p className="t-display"><BigNumber agorot={project.profit_agorot} /></p>
        </BandHero>
      </TopBand>
      {project.budget_agorot != null ? (
        <div className="ui-page-pad">
          <BudgetBar label="תקציב" spentAgorot={project.direct_agorot < 0n ? -project.direct_agorot : project.direct_agorot} budgetAgorot={project.budget_agorot} />
        </div>
      ) : null}
      <div className="ui-page-pad ui-stack">
        <p>הכנסות <BigNumber agorot={project.income_agorot} /></p>
        <p>עלויות ישירות <BigNumber agorot={project.direct_agorot} /></p>
        <p>חלק משותף <BigNumber agorot={project.shared_agorot} /></p>
      </div>
      <h2 className="t-title-3 ui-page-pad">קטגוריות</h2>
      {project.categories.length === 0 ? <p className="ui-page-pad t-hint">אין עדיין הוצאות מסווגות.</p> : (
        <List>
          {project.categories.map((category) => (
            <ListRow key={category.id ?? category.name} variant="project" title={category.name ?? "בלי קטגוריה"} agorot={category.amount_agorot} loss={category.amount_agorot < 0n} />
          ))}
        </List>
      )}
      <h2 className="t-title-3 ui-page-pad">תנועות</h2>
      {project.transactions.length === 0 ? (
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
      )}
      <ArchiveButton projectId={project.id} name={project.name} budget={project.budget_agorot ?? null} finished={project.status === "finished"} />
    </div>
  );
}

function LegacyEmptyProject() {
  const search = usePreviewSearch();
  const location = useLocation();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        trailing={
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

function ArchiveButton({
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
        p_budget_agorot: (budget == null ? null : Number(budget)) as unknown as number,
        p_status: finished ? "active" : "finished",
      }));
    },
  });
  return (
    <div className="ui-page-pad">
      <Button variant="secondary" onClick={() => { setConfirm(true); }}>{finished ? "החזרה לפעיל" : "סיום הפרויקט"}</Button>
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
    </div>
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
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const row = rows[0];
  const approve = useWrite({
    failure: "לא הצלחנו לאשר.",
    keys: ["review", "dashboard", "unpaid"],
    run: async () => {
      if (!row?.project_id || !row.category_id) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("resolve_review", {
        p_id: row.id,
        p_action: "approved",
        p_project_id: row.project_id,
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
        p_project_id: null as unknown as string,
        p_category_id: null as unknown as string,
      }));
    },
  });
  if (!row) return <ReviewEmpty search={search} />;
  const change = `/review/change${search}${search ? "&" : "?"}item=${row.id}`;
  const auto = row.auto_approved_today ?? 0;
  const suggestion = reviewSuggestion(row);
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="רק מה שה-AI לא היה בטוח בו" />
      <div className="ui-review-meter">
        <div
          className="ui-bar ui-bar-thin"
          role="meter"
          aria-label="התקדמות התור"
          aria-valuenow={1}
          aria-valuemin={1}
          aria-valuemax={rows.length}
        >
          <div className="ui-bar-fill" style={{ width: `${String(Math.round((1 / rows.length) * 100))}%` }} />
        </div>
        <span className="t-hint"><bdi dir="ltr">{`1 מתוך ${String(rows.length)}`}</bdi></span>
      </div>
      {auto > 0 ? (
        <p className="ui-review-note">
          <span aria-hidden="true">✓</span>
          <span><bdi dir="ltr">{String(auto)}</bdi> תנועות אושרו אוטומטית היום</span>
        </p>
      ) : null}
      <ReviewCard
        supplier={row.supplier_name ?? row.description}
        sourceLine={`חשבונית מצולמת · ${invoiceDate(row.doc_date)}`}
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
            if (!row.project_id || !row.category_id) {
              toast.show({ tone: "bad", message: "בלי פרויקט וקטגוריה אי אפשר לאשר. בחרו בשינוי." });
              return;
            }
            approve.mutate();
          }}
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

function reviewSuggestion(row: ReviewRow) {
  if (!row.project_name && !row.category_name) return undefined;
  const confidence = row.confidence == null ? "" : ` ${String(row.confidence)}%`;
  return (
    <div className="ui-review-ai">
      <p className="t-hint">הצעת AI</p>
      {row.project_name ? (
        <p className="ui-review-line">
          <span className="t-label">פרויקט</span>
          <span>{row.project_name}{confidence ? <span className="t-hint"><bdi dir="ltr">{confidence.trim()}</bdi></span> : null}</span>
        </p>
      ) : null}
      {row.category_name ? (
        <p className="ui-review-line">
          <span className="t-label">קטגוריה</span>
          <span>{row.category_name}{row.confidence == null ? null : <span className="t-hint"> <bdi dir="ltr">{`${String(row.confidence)}%`}</bdi></span>}</span>
        </p>
      ) : null}
    </div>
  );
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
    toast.show({ message: "הפריט חזר לתור. השיוך שנשמר נשאר." });
  } catch (error) {
    console.error("reopen_review", error);
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
    <div>
      <ScreenHeader title="לאישור" subtitle="רק מה שה-AI לא היה בטוח בו" />
      <EmptyState
        icon={<ReviewIcon />}
        title="הכל מאושר"
        body="אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."
        action={<Button variant="pill" to={`/${search}`}>לדף הבית</Button>}
      />
    </div>
  );
}

export function ChangeForm({
  sample,
}: {
  sample?: { projects: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string; hidden: boolean }> };
} = {}) {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const navigate = useNavigate();
  const toast = useToast();
  const dashboard = useDashboardQuery();
  const categories = useCategoriesQuery();
  const [params] = useSearchParams();
  const item = params.get("item") ?? "";
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const phase = sample ? ({ kind: "ready" } as const) : combinePhase(screenPhase(preview, dashboard), screenPhase(preview, categories));
  const projectOptions = sample?.projects ?? dashboard.data?.projects ?? [];
  const categoryOptions = sample?.categories ?? categories.data ?? [];
  const save = useWrite({
    failure: "לא הצלחנו לשמור את השיוך.",
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
        p_project_id: projectId,
        p_category_id: categoryId,
      }));
    },
  });

  return (
    <RouteSheet title="שינוי שיוך" closeTo={`/review${search}`}>
      {phase.kind === "ready" ? (
        <form
          className="ui-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
            if (projectId === "" || categoryId === "") {
              toast.show({ tone: "bad", message: "בחרו פרויקט וקטגוריה." });
              return;
            }
            save.mutate();
          }}
        >
          <SelectField
            label="פרויקט"
            value={projectId}
            required
            onChange={(event) => { setProjectId(event.target.value); }}
            options={[{ value: "", label: "בחירה" }, ...projectOptions.map((project) => ({ value: project.id, label: project.name }))]}
          />
          <SelectField
            label="קטגוריה"
            value={categoryId}
            required
            onChange={(event) => { setCategoryId(event.target.value); }}
            options={[{ value: "", label: "בחירה" }, ...categoryOptions.filter((category) => !category.hidden).map((category) => ({ value: category.id, label: category.name }))]}
          />
          <Button type="submit" busy={save.isPending}>אישור</Button>
        </form>
      ) : (
        <ScreenState title="שינוי שיוך" phase={phase} onRetry={() => { void dashboard.refetch(); void categories.refetch(); }} />
      )}
    </RouteSheet>
  );
}

export function AddForm() {
  const search = usePreviewSearch();
  return (
    <RouteSheet title="הוספה" closeTo={`/${search}`} returnFocusRef={addTriggerRef}>
      <p className="t-label text-text-secondary">בקרוב תוכלו להוסיף כאן הכנסה או הוצאה</p>
    </RouteSheet>
  );
}

export function UnpaidScreen({ sample }: { sample?: UnpaidRow[] } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const unpaid = useUnpaidQuery();
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, unpaid);
  const rows = sample ?? unpaid.data ?? [];
  const gross = rows.reduce((sum, row) => sum + row.open_gross_agorot, 0n);
  return (
    <ScreenState
      title="חשבוניות פתוחות"
      subtitle={phase.kind === "ready" ? `לא נכלל ברווח. סכום פתוח כולל מע״מ ${formatIls(gross)}.` : undefined}
      backTo={`/${search}`}
      phase={phase.kind === "ready" && rows.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void unpaid.refetch(); }}
      empty={<EmptyState icon={<DocumentIcon />} title="הכל שולם" body="אין חשבוניות פתוחות כרגע." />}
    >
      <List>
        {rows.map((row) => (
          <ListRow
            key={row.id}
            variant="transaction"
            title={row.customer_name ?? row.description}
            hint={[row.description, row.project_name, formatDayMonth(row.doc_date)].filter((part) => part != null && part !== "").join(" · ")}
            agorot={row.open_gross_agorot}
            sign="in"
            source="invoice"
          />
        ))}
      </List>
    </ScreenState>
  );
}

export function TransactionScreen() {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const detail = useTransactionQuery(transactionId);
  const phase = screenPhase(preview, detail);
  const remove = useWrite({
    failure: "לא הצלחנו למחוק.",
    keys: ["dashboard", "txn", "unpaid", "review"],
    onSuccess: () => {
      setConfirm(false);
      void navigate(`/${search}`);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase || !detail.data) throw new Error("supabase");
      assertNoError(await supabase.rpc("delete_transaction", { p_id: detail.data.id }));
    },
  });
  if (phase.kind === "loading" || phase.kind === "error" || phase.kind === "empty") {
    return <ScreenState title="פרטי תנועה" backTo={`/${search}`} phase={phase.kind === "empty" ? { kind: "empty" } : phase} onRetry={() => { void detail.refetch(); }} empty={<p className="ui-page-pad t-hint">אין תנועה להצגה.</p>} />;
  }
  if (!detail.data) return <ScreenHeader title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={`/${search}`} />;
  const txn = detail.data;
  return (
    <div>
      <ScreenHeader title="פרטי תנועה" backTo={`/${search}`} />
      <p className="t-display ui-page-pad"><BigNumber agorot={txn.amount_net} presentation="detail" /></p>
      <p className="ui-page-pad">{txn.description}</p>
      <p className="t-hint ui-page-pad">{formatDayMonth(txn.doc_date)} · {txn.project_name ?? "בלי פרויקט"} · {txn.category_name ?? "בלי קטגוריה"}</p>
      <p className="t-hint ui-page-pad">לפני מע״מ. מע״מ <bdi dir="ltr">{formatIls(txn.vat_amount, { agorot: true })}</bdi> · {txn.vat_status === "assumed" ? "מע״מ משוער 18%" : txn.vat_status}</p>
      <p className="t-hint ui-page-pad">{txn.supplier_name ?? txn.customer_name ?? ""}</p>
      <div className="ui-stack ui-page-pad">
        <Button variant="secondary" to={`/transactions/${txn.id}/split${search}`}>פיצול</Button>
        {txn.source === "manual" ? (
          <Button variant="danger" icon={<TrashIcon />} onClick={() => { setConfirm(true); }}>מחיקה</Button>
        ) : (
          <p className="t-hint">תנועה מ-SUMIT לא נמחקת כאן. היא מתעדכנת בסנכרון.</p>
        )}
      </div>
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

export function SplitScreen() {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const toast = useToast();
  const dashboard = useDashboardQuery();
  const phase = screenPhase(preview, dashboard);
  const projects = dashboard.data?.projects ?? [];
  const [shares, setShares] = useState<Record<string, string>>({});
  const total = Object.values(shares).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const save = useWrite({
    failure: "החלקים צריכים להסתכם ב-100%.",
    success: "הפיצול נשמר",
    keys: ["dashboard", "txn", "project"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const rows = Object.entries(shares)
        .filter(([, value]) => Number(value) > 0)
        .map(([project, value]) => ({ project_id: project, share_bp: Math.round(Number(value) * 100) }));
      assertNoError(await supabase.rpc("save_split", { p_transaction_id: transactionId, p_shares: rows }));
    },
  });

  return (
    <ScreenState
      title="פיצול"
      subtitle={`החלקים מסתכמים ב-100%. עכשיו ${total.toFixed(0)}%.`}
      backTo={`/transactions/${transactionId}${search}`}
      phase={phase.kind === "ready" && projects.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void dashboard.refetch(); }}
      empty={<EmptyState icon={<ProjectsIcon />} title="אין פרויקטים לפיצול" body="פיצול מחכה לפרויקט אחד לפחות." />}
    >
      <form
        className="ui-stack ui-page-pad"
        onSubmit={(event) => {
          event.preventDefault();
          if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
          save.mutate();
        }}
      >
        {projects.map((project) => (
          <TextField
            key={project.id}
            label={project.name}
            inputMode="decimal"
            value={shares[project.id] ?? ""}
            placeholder="0"
            onChange={(event) => { setShares({ ...shares, [project.id]: event.target.value }); }}
          />
        ))}
        <Button type="submit" busy={save.isPending}>שמירת הפיצול</Button>
      </form>
    </ScreenState>
  );
}

export function SettingsScreen({
  sample,
}: {
  sample?: { name: string | null; vatRegistered: boolean; connected: boolean; companyId: number | null; lastError: string | null };
} = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const { session } = useAuth();
  const toast = useToast();
  const status = useSumitStatusQuery();
  const dashboard = useDashboardQuery();
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const phase = sample ? ({ kind: "ready" } as const) : combinePhase(screenPhase(preview, dashboard), screenPhase(preview, status));
  const connect = useWrite({
    failure: "החיבור נכשל. בדקו את המזהה ואת המפתח.",
    success: "SUMIT מחובר. המפתח נשאר בשרת.",
    keys: ["sumit", "dashboard"],
    onSuccess: () => { setApiKey(""); },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const base = import.meta.env.VITE_SUPABASE_URL as string;
      if (!token || !base) throw new Error("unauthorized");
      const response = await fetch(`${base}/functions/v1/sumit-connect`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          "content-type": "application/json",
        },
        body: JSON.stringify({ companyId: Number(companyId), apiKey }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "connect_failed");
      }
      setApiKey("");
    },
  });
  const refresh = useWrite({
    failure: "הרענון נכשל.",
    success: "הרענון הסתיים.",
    keys: ["sumit", "dashboard", "unpaid", "review", "project"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const base = import.meta.env.VITE_SUPABASE_URL as string;
      const response = await fetch(`${base}/functions/v1/sumit-sync`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token ?? ""}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          "content-type": "application/json",
        },
        body: JSON.stringify({ force: true }),
      });
      if (!response.ok) throw new Error("sync_failed");
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

  if (phase.kind !== "ready") {
    return (
      <ScreenState
        title="הגדרות"
        phase={phase}
        onRetry={() => { void dashboard.refetch(); void status.refetch(); }}
        empty={
          <Section title="העסק">
            <p>עדיין בלי עסק</p>
          </Section>
        }
      />
    );
  }

  const connected = sample ? sample.connected : status.data?.connected === true;
  const businessName = sample ? sample.name : dashboard.data?.name;
  const vatRegistered = sample ? sample.vatRegistered : dashboard.data?.vat_registered !== false;
  const sumitId = sample ? sample.companyId : status.data?.sumit_company_id;
  const lastError = hebrewSumitError(sample ? sample.lastError : status.data?.last_error);
  return (
    <div>
      <ScreenHeader title="הגדרות" />
      <Section title="העסק">
        <p>{businessName ?? "עדיין בלי עסק"}</p>
        {dashboard.data || sample ? <p className="t-hint">{vatRegistered ? "עוסק מורשה" : "עוסק פטור"}</p> : null}
      </Section>
      <Section title="חשבון Google">
        <p>{session?.user.email ?? "לא מחובר"}</p>
        {preview === "off" ? (
          <Button variant="secondary" busy={signOut.isPending} onClick={() => { signOut.mutate(); }}>
            יציאה
          </Button>
        ) : null}
      </Section>
      <Section title="SUMIT">
        <p>
          {connected ? (
            <>
              מחובר לחברה <bdi dir="ltr">{String(sumitId ?? "")}</bdi>
            </>
          ) : (
            "לא מחובר"
          )}
        </p>
        {lastError ? <FormError>{lastError}</FormError> : null}
        <form
          className="ui-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
            connect.mutate();
          }}
        >
          <TextField label="CompanyID" value={companyId} inputMode="numeric" onChange={(event) => { setCompanyId(event.target.value); }} />
          <TextField label="מפתח API" type="password" value={apiKey} autoComplete="off" onChange={(event) => { setApiKey(event.target.value); }} />
          <Button type="submit" busy={connect.isPending}>חיבור</Button>
        </form>
        <Button
          variant="secondary"
          busy={refresh.isPending}
          onClick={() => {
            if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
            refresh.mutate();
          }}
        >
          רענון עכשיו
        </Button>
        {connected ? (
          <Button variant="secondary" onClick={() => { setDisconnectOpen(true); }}>
            ניתוק
          </Button>
        ) : null}
      </Section>
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
      <nav className="ui-stack ui-page-pad">
        <TextLink to={`/settings/categories${search}`}>קטגוריות</TextLink>
        <TextLink to={`/projects${search}`}>פרויקטים</TextLink>
        <TextLink to={`/notifications${search}`}>התראות</TextLink>
      </nav>
    </div>
  );
}

export function CategoriesScreen({ sample }: { sample?: CategoryRow[] } = {}) {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const toast = useToast();
  const categories = useCategoriesQuery();
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, categories);
  const rows = sample ?? categories.data ?? [];
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [hideTarget, setHideTarget] = useState<CategoryRow | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
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
  return (
    <ScreenState
      title="קטגוריות"
      backTo={`/settings${search}`}
      phase={phase.kind === "ready" && rows.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void categories.refetch(); }}
      empty={<EmptyState icon={<DocumentIcon />} title="אין עדיין קטגוריות" body="הקטגוריות נוצרות עם העסק." />}
    >
      <List>
        {rows.map((category) => (
          <ListRow
            key={category.id}
            variant="item"
            title={category.name}
            hint={`${category.kind === "income" ? "הכנסה" : "הוצאה"}${category.hidden ? " · מוסתרת" : ""}`}
            action={
              <Button
                variant="pill"
                onClick={() => {
                  setHideTarget(category);
                }}
              >
                {category.hidden ? "הצגה" : "הסתרה"}
              </Button>
            }
          />
        ))}
      </List>
      <form
        className="ui-stack ui-page-pad"
        onSubmit={(event) => {
          event.preventDefault();
          if (mergeFrom === "" || mergeInto === "" || mergeFrom === mergeInto) {
            toast.show({ tone: "bad", message: "בחרו שתי קטגוריות שונות." });
            return;
          }
          setMergeOpen(true);
        }}
      >
        <h2 className="t-title-3">מיזוג</h2>
        <SelectField
          label="מקטגוריה"
          value={mergeFrom}
          onChange={(event) => { setMergeFrom(event.target.value); }}
          options={[{ value: "", label: "בחירה" }, ...rows.map((category) => ({ value: category.id, label: category.name }))]}
        />
        <SelectField
          label="אל"
          value={mergeInto}
          onChange={(event) => { setMergeInto(event.target.value); }}
          options={[{ value: "", label: "בחירה" }, ...rows.filter((category) => !category.hidden).map((category) => ({ value: category.id, label: category.name }))]}
        />
        <Button type="submit">מיזוג</Button>
      </form>
      <ConfirmSheet
        open={hideTarget != null}
        onOpenChange={(open) => { if (!open) setHideTarget(null); }}
        title={hideTarget?.hidden ? "להציג את הקטגוריה?" : "להסתיר את הקטגוריה?"}
        item={hideTarget?.name}
        consequence="הקטגוריה לא נמחקת. אפשר להחזיר אותה."
        confirmLabel={hideTarget?.hidden ? "הצגה" : "הסתרה"}
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
        busy={merge.isPending}
        onConfirm={() => {
          if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
          merge.mutate();
        }}
      />
    </ScreenState>
  );
}

export function NotificationsScreen() {
  const search = usePreviewSearch();
  return (
    <div>
      <ScreenHeader
        title="התראות"
        subtitle="שתי הודעות, שעון ישראל. סיכום ביום ראשון ב-08:00, ותזכורת לאישור ב-18:00 רק כשיש תור."
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
