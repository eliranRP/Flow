import { formatIls, shekelsToAgorot, type CategoryRow, type Dashboard, type ProjectDetail, type ReviewRow, type TransactionDetail, type UnpaidRow } from "@flow/shared";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { useEffect, useState, type ReactNode, type SubmitEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { Chip } from "../ui/chip";
import { formatDayMonth, israelToday } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { BackIcon, CameraIcon, CheckIcon, ChevronIcon, DocumentIcon, GripIcon, MoreIcon, ProjectsIcon, ReviewIcon, SearchIcon, TrashIcon } from "../ui/icons";
import { BandFigures, BandHero, FormError, SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { MoneyField } from "../ui/money-field";
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
import { ListSkeleton } from "../ui/skeleton";

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
    <main className="ui-onboard">
      <ScreenHeader title="פרטי העסק" subtitle="השם שיופיע בבית." />
      <form className="ui-page-pad" onSubmit={submit}>
        <p className="t-hint">שלב 1</p>
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
        action={<Button variant="pill" onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
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
        action={<Button variant="pill" onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
        loading={
          <>
            <div className="ui-page-pad ui-stack">
              <SearchField label="חיפוש פרויקט" value="" onChange={() => undefined} placeholder="חיפוש פרויקט או לקוח" disabled />
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

function projectMargin(project: { income_agorot: bigint; profit_agorot: bigint }): string | undefined {
  if (project.income_agorot <= 0n) return undefined;
  const pct = Number((project.profit_agorot * 100n) / project.income_agorot);
  return pct < 0 ? `רווחיות −${String(Math.abs(pct))}%` : `רווחיות ${String(pct)}%`;
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
        <SearchField label="חיפוש פרויקט" value={query} onChange={setQuery} placeholder="חיפוש פרויקט או לקוח" />
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={`לא מצאנו ״${needle}״`}
          body="החיפוש הוא לפי שם הפרויקט. גם פרויקטים שהסתיימו נכללים."
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

function absAgorot(value: bigint): bigint {
  return value < 0n ? -value : value;
}

export function ProjectDetailScreen({ sample }: { sample?: NonNullable<ProjectDetail> } = {}) {
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  const detail = useProjectQuery(sample ? "" : projectId);
  const preview = useHomePreview();
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, detail);
  const [moves, setMoves] = useState(false);
  const [overhead, setOverhead] = useState(false);
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
  const income = absAgorot(project.income_agorot);
  const expenses = absAgorot(project.direct_agorot);
  const margin = income > 0n ? Number((project.profit_agorot * 100n) / income) : null;
  const marginText = margin == null ? "" : margin < 0 ? ` · רווחיות −${String(Math.abs(margin))}%` : ` · רווחיות ${String(margin)}%`;
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <TopBand
        wordmark={false}
        leading={
          <IconButton label="חזרה" to={`/projects${search}`} onBand>
            <BackIcon />
          </IconButton>
        }
        trailing={<ProjectMenu projectId={project.id} name={project.name} budget={project.budget_agorot ?? null} finished={project.status === "finished"} />}
      >
        <div className="ui-band-hero">
          <h1 className="t-title-2">{project.name}</h1>
          <p className="t-label">{project.state_label ?? (project.status === "finished" ? "הסתיים" : "פעיל")}</p>
        </div>
        <BandHero>
          <p className="ui-band-label t-label">רווח{marginText}</p>
          <p className="t-display"><BigNumber agorot={project.profit_agorot} /></p>
          <BandFigures income={formatIls(income)} expense={formatIls(expenses)} />
        </BandHero>
      </TopBand>
      <div className="ui-page-pad">
        <Toggle
          label="אחרי חלק בהוצאות כלליות"
          hint={overhead ? "דלוק · מציג רווח אחרי כלליות" : "כבוי · מציג רווח לפני כלליות"}
          checked={overhead}
          onChange={setOverhead}
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
                source={txn.source === "hapoalim" ? "bank" : "invoice"}
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
      {auto > 0 ? (
        <div className="ui-banner">
          <span className="ui-banner-icon">
            <ReviewIcon />
          </span>
          <span className="ui-row-text">
            <span className="ui-row-title">
              <bdi dir="ltr">{String(auto)}</bdi> תנועות שויכו היום בלי להמתין בתור
            </span>
          </span>
          <TextLink to={`/review${search}`}>צפייה</TextLink>
        </div>
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
            if (!row.project_id || !row.category_id) {
              toast.show({ tone: "bad", message: "בלי פרויקט וקטגוריה אי אפשר לאשר. בחרו בשינוי." });
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

type ChangeProject = { id: string; name: string; code?: string; hint?: string };

export function ChangeForm({
  sample,
}: {
  sample?: {
    supplier: string;
    amount: string;
    suggestionId?: string;
    recentId?: string;
    categoryId?: string;
    projects: ChangeProject[];
    categories: Array<{ id: string; name: string; hidden: boolean; kind?: string }>;
  };
} = {}) {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const navigate = useNavigate();
  const toast = useToast();
  const dashboard = useDashboardQuery(sample == null);
  const categories = useCategoriesQuery(sample == null);
  const review = useReviewQuery(sample == null);
  const [params] = useSearchParams();
  const item = params.get("item") ?? "";
  const row = (review.data ?? []).find((entry) => entry.id === item);
  const [projectId, setProjectId] = useState(sample?.suggestionId ?? "");
  const [categoryId, setCategoryId] = useState(sample?.categoryId ?? "");
  const [query, setQuery] = useState("");
  const [moreCategories, setMoreCategories] = useState(false);
  const [remember, setRemember] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const phase = sample ? ({ kind: "ready" } as const) : combinePhase(screenPhase(preview, dashboard), screenPhase(preview, categories));
  const projectOptions: ChangeProject[] = sample?.projects ?? (dashboard.data?.projects ?? []).map((project) => ({ id: project.id, name: project.name }));
  const categoryOptions = (sample?.categories ?? categories.data ?? []).filter((category) => !category.hidden && category.kind !== "income");
  const suggested = projectOptions.find((project) => project.id === (sample?.suggestionId ?? row?.project_id ?? "")) ?? projectOptions[0];
  const recent = projectOptions.find((project) => project.id === sample?.recentId) ?? projectOptions.find((project) => project.id !== suggested?.id);
  const needle = query.trim();
  const listed = projectOptions.filter((project) => needle === "" || project.name.includes(needle) || (project.code ?? "").includes(needle));
  const shownCategories = moreCategories ? categoryOptions : categoryOptions.slice(0, 3);
  const chosenProject = projectOptions.find((project) => project.id === projectId);
  const chosenCategory = categoryOptions.find((category) => category.id === categoryId);
  const hint = sample
    ? `${sample.supplier} · ${sample.amount}`
    : row
      ? `${row.supplier_name ?? row.description} · ${formatIls(absAgorot(row.amount_net))}`
      : undefined;
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
    <RouteSheet title="שינוי שיוך" hint={hint} closeTo={`/review${search}`}>
      {phase.kind === "ready" ? (
        <form
          className="ui-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (sample) return;
            if (blockedPreview(preview, (message) => { toast.show({ tone: "bad", message }); })) return;
            if (projectId === "" || categoryId === "") {
              toast.show({ tone: "bad", message: "בחרו פרויקט וקטגוריה." });
              return;
            }
            save.mutate();
          }}
        >
          <h2 className="t-title-3">פרויקט</h2>
          <div className="flex flex-wrap gap-2">
            {suggested ? (
              <Chip
                pressed={projectId === suggested.id}
                onClick={() => {
                  setProjectId(suggested.id);
                }}
              >
                {`${suggested.name} · הצעה`}
              </Chip>
            ) : null}
            {recent ? (
              <Chip
                pressed={projectId === recent.id}
                onClick={() => {
                  setProjectId(recent.id);
                }}
              >
                {`${recent.name} · אחרון`}
              </Chip>
            ) : null}
          </div>
          <SearchField label="חיפוש פרויקט" value={query} onChange={setQuery} placeholder="חיפוש פרויקט או קוד (P-12)" />
          <div className="ui-project-list">
            {listed.map((project) => (
              <button
                key={project.id}
                type="button"
                className="ui-row ui-hit"
                aria-pressed={projectId === project.id}
                onClick={() => {
                  setProjectId(project.id);
                }}
              >
                <span className="ui-row-main">
                  <span className="ui-row-text">
                    <span className="ui-row-title">{project.code ? `${project.code} · ${project.name}` : project.name}</span>
                  </span>
                </span>
                {project.hint ? <span className="t-hint">{project.hint}</span> : null}
              </button>
            ))}
          </div>
          <p className="ui-page-title-row">
            <TextLink
              chevron={false}
              onClick={() => {
                setNewOpen(true);
              }}
            >
              פרויקט חדש
            </TextLink>
            <TextLink
              chevron={false}
              onClick={() => {
                toast.show({ message: "הפיצול נעשה ממסך התנועה, אחרי השיוך." });
              }}
            >
              פיצול בין פרויקטים
            </TextLink>
          </p>
          <h2 className="t-title-3">קטגוריה</h2>
          <div className="flex flex-wrap gap-2">
            {shownCategories.map((category) => (
              <Chip
                key={category.id}
                pressed={categoryId === category.id}
                onClick={() => {
                  setCategoryId(category.id);
                }}
              >
                {category.name}
              </Chip>
            ))}
            {!moreCategories && categoryOptions.length > 3 ? (
              <Chip
                onClick={() => {
                  setMoreCategories(true);
                }}
              >
                עוד…
              </Chip>
            ) : null}
          </div>
          <Toggle
            label="לזכור לספק הזה"
            hint={chosenProject && chosenCategory ? `${chosenProject.name} · ${chosenCategory.name}` : "השיוך נשמר עם האישור"}
            checked={remember}
            onChange={setRemember}
          />
          <Button type="submit" busy={save.isPending} icon={<CheckIcon />}>שמירה ואישור</Button>
        </form>
      ) : (
        <ScreenState title="שינוי שיוך" phase={phase} onRetry={() => { void dashboard.refetch(); void categories.refetch(); }} />
      )}
      <Sheet open={newOpen} onOpenChange={setNewOpen} title="פרויקט">
        <ProjectForm onClose={() => { setNewOpen(false); }} />
      </Sheet>
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
  const rows = (sample ?? unpaid.data ?? []).filter((row) => !hidden.includes(row.id));
  const gross = rows.reduce((sum, row) => sum + absAgorot(row.open_gross_agorot), 0n);
  return (
    <ScreenState
      title="חשבוניות שלא שולמו"
      backTo={`/${search}`}
      phase={phase.kind === "ready" && rows.length === 0 ? { kind: "empty" } : phase}
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

export function TransactionScreen({ sample }: { sample?: NonNullable<TransactionDetail> } = {}) {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const detail = useTransactionQuery(sample ? "" : transactionId);
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
  if (phase.kind === "loading" || phase.kind === "error" || phase.kind === "empty") {
    return <ScreenState title="פרטי תנועה" backTo={`/${search}`} phase={phase.kind === "empty" ? { kind: "empty" } : phase} onRetry={() => { void detail.refetch(); }} empty={<p className="ui-page-pad t-hint">אין תנועה להצגה.</p>} />;
  }
  const txn = sample ?? detail.data;
  if (!txn) return <ScreenHeader title="פרטי תנועה" subtitle="התנועה לא נמצאה." backTo={`/${search}`} />;
  return (
    <div>
      <ScreenHeader title="פרטי תנועה" backTo={`/${search}`} />
      <p className="t-display ui-page-pad"><BigNumber agorot={txn.amount_net} presentation="detail" /></p>
      <p className="ui-page-pad">{txn.description}</p>
      <p className="t-hint ui-page-pad">{formatDayMonth(txn.doc_date)} · {txn.project_name ?? "בלי פרויקט"} · {txn.category_name ?? "בלי קטגוריה"}</p>
      <p className="t-hint ui-page-pad">לפני מע״מ. מע״מ <bdi dir="ltr">{formatIls(txn.vat_amount, { agorot: true })}</bdi> · {vatStatusLabel(txn.vat_status)}</p>
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

export function SplitScreen({ sampleProjects }: { sampleProjects?: Array<{ id: string; name: string }> } = {}) {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const toast = useToast();
  const dashboard = useDashboardQuery(sampleProjects == null);
  const txn = useTransactionQuery(sampleProjects ? "" : transactionId);
  const phase = sampleProjects ? ({ kind: "ready" } as const) : screenPhase(preview, dashboard);
  const projects = sampleProjects ?? dashboard.data?.projects ?? [];
  const [shares, setShares] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !txn.data?.allocations) return;
    const next: Record<string, string> = {};
    for (const row of txn.data.allocations) {
      next[row.project_id] = String(row.share_bp / 100);
    }
    setShares(next);
    setSeeded(true);
  }, [seeded, txn.data]);
  const total = Object.values(shares).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const save = useWrite({
    failure: (error) => (error.message.includes("10000") ? "החלקים צריכים להסתכם ב-100%." : "לא הצלחנו לשמור את הפיצול."),
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

type SettingsSample = {
  name: string | null;
  vatRegistered: boolean;
  connected: boolean;
  companyId: number | null;
  lastError: string | null;
  email?: string | null;
  projectCount?: number;
  expenseCategories?: number;
  incomeCategories?: number;
};

function SettingsKicker({ title }: { title: string }) {
  return <h2 className="ui-settings-kicker t-hint">{title}</h2>;
}

function SettingsLink({ to, title, hint, icon }: { to: string; title: string; hint?: string; icon: ReactNode }) {
  return (
    <Link to={to} className="ui-row ui-hit">
      <span className="ui-row-main">
        <span className="ui-row-icon">{icon}</span>
        <span className="ui-row-text">
          <span className="ui-row-title" title={title}>{title}</span>
          {hint ? <span className="ui-row-hint">{hint}</span> : null}
        </span>
      </span>
      <ChevronIcon />
    </Link>
  );
}

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
  const [weekly, setWeekly] = useState(false);
  const [reminder, setReminder] = useState(false);
  const [overhead, setOverhead] = useState(false);
  const phase = sample ? ({ kind: "ready" } as const) : combinePhase(screenPhase(preview, dashboard), screenPhase(preview, status));
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

  if (phase.kind !== "ready") {
    return (
      <ScreenState
        title="הגדרות"
        phase={phase}
        onRetry={() => { void dashboard.refetch(); void status.refetch(); }}
        empty={<p className="ui-page-pad t-hint">עדיין בלי עסק</p>}
      />
    );
  }

  const connected = sample ? sample.connected : status.data?.connected === true;
  const businessName = sample ? sample.name : dashboard.data?.name;
  const vatRegistered = sample ? sample.vatRegistered : dashboard.data?.vat_registered !== false;
  const sumitId = sample ? sample.companyId : status.data?.sumit_company_id;
  const lastError = hebrewSumitError(sample ? sample.lastError : status.data?.last_error);
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
      <SettingsKicker title="החברה" />
      <div className="ui-project-list">
        <div className="ui-row">
          <span className="ui-row-main">
            <span className="ui-row-icon"><ProjectsIcon /></span>
            <span className="ui-row-text">
              <span className="ui-row-title">{businessName ?? "עדיין בלי עסק"}</span>
              <span className="ui-row-hint">{vatRegistered ? "עוסק מורשה" : "עוסק פטור"}</span>
            </span>
          </span>
        </div>
        {email ? (
          <div className="ui-row">
            <span className="ui-row-text">
              <span className="ui-row-title" title={email}>{email}</span>
              <span className="ui-row-hint">חשבון Google</span>
            </span>
          </div>
        ) : null}
      </div>
      <SettingsKicker title="חיבור SUMIT" />
      <div className="ui-project-list">
        {connected ? (
          <div className="ui-row">
            <span className="ui-row-text">
              <span className="ui-row-title">SUMIT מחובר</span>
              <span className="ui-row-hint">
                מספר חברה <bdi dir="ltr">{String(sumitId ?? "")}</bdi>
              </span>
            </span>
          </div>
        ) : (
          <button type="button" className="ui-row ui-hit" aria-label="חיבור SUMIT" onClick={() => { setConnectOpen(true); }}>
            <span className="ui-row-text">
              <span className="ui-row-title">חיבור SUMIT</span>
              <span className="ui-row-hint">מספר חברה ומפתח API</span>
            </span>
            <ChevronIcon />
          </button>
        )}
      </div>
      {lastError ? <div className="ui-page-pad"><FormError>{lastError}</FormError></div> : null}
      <div className="ui-stack ui-page-pad">
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
      </div>
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
      <SettingsKicker title="סיווג" />
      <div className="ui-project-list">
        <SettingsLink to={`/settings/categories${search}`} title="קטגוריות" hint={categoryHint} icon={<DocumentIcon />} />
        <SettingsLink to={`/projects${search}`} title="פרויקטים" hint={projectCount == null ? undefined : `${String(projectCount)} פעילים`} icon={<ProjectsIcon />} />
      </div>
      <SettingsKicker title="התראות" />
      <div className="ui-page-pad">
        <Toggle label="סיכום שבועי" hint="ההודעות לא נשלחות" checked={weekly} onChange={setWeekly} />
        <Toggle label="תזכורת לפריטים ממתינים" hint="ההודעות לא נשלחות" checked={reminder} onChange={setReminder} />
      </div>
      <SettingsKicker title="אישור ותצוגה" />
      <div className="ui-page-pad">
        <Toggle label="אישור אוטומטי בביטחון גבוה" hint="לא פעיל" checked={false} disabled onChange={() => undefined} />
        <Toggle
          label="רווח אחרי חלק בכלליות"
          hint={overhead ? "דלוק · מציג רווח אחרי כלליות" : "כבוי · מציג רווח לפני כלליות"}
          checked={overhead}
          onChange={setOverhead}
        />
      </div>
      <SettingsKicker title="נתונים" />
      <div className="ui-project-list">
        <SettingsLink to={`/notifications${search}`} title="התראות" hint="אין עדיין התראות" icon={<ReviewIcon />} />
        {preview === "off" ? (
          <button type="button" className="ui-row ui-hit ui-row-danger" disabled={signOut.isPending} onClick={() => { signOut.mutate(); }}>
            התנתקות
          </button>
        ) : null}
      </div>
      <p className="ui-poc t-hint"><bdi dir="ltr">Flow · POC 0.1</bdi></p>
    </div>
  );
}

export function CategoriesScreen({ sample }: { sample?: Array<CategoryRow & { count?: number }> } = {}) {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const toast = useToast();
  const categories = useCategoriesQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, categories);
  const rows: Array<CategoryRow & { count?: number }> = sample ?? categories.data ?? [];
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [showHidden, setShowHidden] = useState(false);
  const [menu, setMenu] = useState<(CategoryRow & { count?: number }) | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [hideTarget, setHideTarget] = useState<CategoryRow | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
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
  const visible = rows.filter((category) => category.kind === kind && (showHidden || !category.hidden));
  const hiddenCount = rows.filter((category) => category.hidden).length;
  const mergeTargets = rows.filter((category) => category.id !== mergeFrom && category.kind === kind && !category.hidden);
  return (
    <ScreenState
      title="קטגוריות"
      kicker="הגדרות"
      backTo={`/settings${search}`}
      phase={phase.kind === "ready" && rows.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void categories.refetch(); }}
      empty={<EmptyState icon={<DocumentIcon />} title="אין עדיין קטגוריות" body="הקטגוריות נוצרות עם העסק." />}
    >
      <div className="ui-page-pad">
        <SegmentedControl
          label="סוג"
          value={kind}
          onChange={setKind}
          options={[
            { value: "expense", label: "הוצאות" },
            { value: "income", label: "הכנסות" },
          ]}
        />
      </div>
      <List>
        {visible.map((category) => (
          <ListRow
            key={category.id}
            variant="item"
            title={category.name}
            hint={category.count == null ? (category.hidden ? "מוסתרת" : undefined) : String(category.count)}
            action={
              <span className="inline-flex items-center">
                <span className="ui-grip" aria-hidden="true"><GripIcon /></span>
                <IconButton
                  label={`עוד, ${category.name}`}
                  onClick={() => {
                    setMenu(category);
                  }}
                >
                  <MoreIcon />
                </IconButton>
              </span>
            }
          />
        ))}
      </List>
      <p className="ui-page-pad">
        <TextLink
          chevron={false}
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          + קטגוריה חדשה
        </TextLink>
      </p>
      {hiddenCount > 0 ? (
        <p className="ui-page-pad">
          <TextLink
            tone="quiet"
            onClick={() => {
              setShowHidden((current) => !current);
            }}
          >
            מוסתרות · <bdi dir="ltr">{String(hiddenCount)}</bdi>
          </TextLink>
        </p>
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
            {menu?.hidden ? "הצגה" : "הסתרה"}
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
      <Sheet open={createOpen} onOpenChange={setCreateOpen} title="קטגוריה חדשה">
        <p className="t-label">יצירת קטגוריה לא נשמרת בשלב הזה. הקטגוריות נוצרות עם העסק, ואפשר להסתיר או למזג.</p>
      </Sheet>
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
        destructive
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
