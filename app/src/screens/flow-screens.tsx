import { formatIls, shekelsToAgorot, type ReviewRow } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type SubmitEvent } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { addTriggerRef } from "../add-trigger";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { withSheetBackground } from "../sheet-background";
import {
  useBooks,
  useCategoriesQuery,
  useDashboardQuery,
  useInvalidateBooks,
  useReviewQuery,
  useSumitStatusQuery,
  useUnpaidQuery,
} from "../use-books";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { formatDayMonth } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { BackIcon, CameraIcon, DocumentIcon, ProjectsIcon, ReviewIcon, SearchIcon } from "../ui/icons";
import { BandHero } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { MoneyField } from "../ui/money-field";
import { BudgetBar } from "../ui/progress-bar";
import { ReviewCard } from "../ui/review-card";
import { ScreenHeader } from "../ui/screen-header";
import { SearchField } from "../ui/search-field";
import { SegmentedControl } from "../ui/segmented-control";
import { SelectField } from "../ui/select-field";
import { Sheet } from "../ui/sheet";
import { RouteSheet } from "../ui/route-sheet";
import { Stat, StatGrid } from "../ui/stat";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { Toast } from "../ui/toast";
import { TopBand } from "../ui/top-band";

function ag(value: number): bigint {
  return BigInt(Math.trunc(value));
}

function ScreenMessage({ title, body, loading = false }: { title: string; body: string; loading?: boolean }) {
  return (
    <>
      <ScreenHeader title={title} />
      <p className="t-label page-pad text-text-secondary" role={loading ? "status" : undefined} aria-busy={loading || undefined}>
        {body}
      </p>
    </>
  );
}

export function OnboardingScreen() {
  const navigate = useNavigate();
  const preview = useHomePreview();
  const [name, setName] = useState("");
  const [vat, setVat] = useState<"registered" | "exempt">("registered");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (preview !== "off") {
      setError("במצב תצוגה הפרטים לא נשמרים.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setError("אין חיבור לשרת.");
      return;
    }
    setPending(true);
    const { error: rpcError } = await supabase.rpc("create_company", {
      p_name: name.trim(),
      p_vat_registered: vat === "registered",
    });
    setPending(false);
    if (rpcError) {
      setError(rpcError.message.includes("already") ? "כבר יש עסק על החשבון." : "לא הצלחנו לשמור. נסו שוב.");
      return;
    }
    void navigate("/", { replace: true });
  }

  return (
    <main>
      <ScreenHeader title="פרטי העסק" subtitle="השם שיופיע בבית, ומצב המע״מ." />
      <form className="stack page-pad" onSubmit={(event) => { void submit(event); }}>
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
        {error ? <p className="form-error">{error}</p> : null}
        <Button type="submit" busy={pending}>המשך</Button>
      </form>
    </main>
  );
}

export function ProjectsScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const dashboard = useDashboardQuery();
  const books = useBooks();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showFinished, setShowFinished] = useState(true);
  const empty = (
    <>
      <ScreenHeader title="פרויקטים" />
      <EmptyState
        icon={<ProjectsIcon />}
        title="עוד אין פרויקטים"
        body="פרויקט נוצר מסעיף תקציב ב-SUMIT, או מכאן."
        action={<Button variant="pill" onClick={() => { setOpen(true); }}>פרויקט חדש</Button>}
      />
      <Sheet open={open} onOpenChange={setOpen} title="פרויקט">
        <ProjectForm onClose={() => { setOpen(false); }} />
      </Sheet>
    </>
  );
  if (preview === "empty") return empty;
  if (dashboard.isLoading) return <ScreenMessage title="פרויקטים" body="טוען…" loading />;
  if (dashboard.isError || !dashboard.data) return <ScreenMessage title="פרויקטים" body="לא הצלחנו לטעון את הפרויקטים." />;
  const projects = dashboard.data.projects;
  if (projects.length === 0) return empty;
  const active = projects.filter((project) => project.status === "active").length;
  const finished = projects.length - active;
  const needle = query.trim();
  const visible = projects.filter((project) => {
    if (!showFinished && project.status === "finished") return false;
    if (needle === "") return true;
    return project.name.includes(needle);
  });
  return (
    <div>
      <ScreenHeader title="פרויקטים" subtitle={`${String(active)} פעילים · רווח ${books.period.label}`} />
      <div className="page-pad stack">
        <Button variant="pill" onClick={() => { setOpen(true); }}>פרויקט חדש</Button>
        <SearchField label="חיפוש פרויקט" value={query} onChange={setQuery} />
        {finished > 0 ? (
          <Checkbox label="הצגת פרויקטים שהסתיימו" checked={showFinished} onChange={setShowFinished} />
        ) : null}
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={`לא מצאנו ״${needle}״`}
          body="אפשר לחפש לפי שם הפרויקט."
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
              agorot={ag(project.profit_agorot)}
              loss={project.profit_agorot < 0}
              href={`/projects/${project.id}${search}`}
            />
          ))}
        </List>
      )}
      <Sheet open={open} onOpenChange={setOpen} title="פרויקט">
        <ProjectForm onClose={() => { setOpen(false); }} />
      </Sheet>
    </div>
  );
}

function ProjectForm({ onClose, projectId }: { onClose: () => void; projectId?: string }) {
  const preview = useHomePreview();
  const invalidate = useInvalidateBooks();
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (preview !== "off") {
      setError("במצב תצוגה זה לא נשמר.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    const agorot = budget.trim() === "" ? null : Number(shekelsToAgorot(budget));
    const { error: rpcError } = await supabase.rpc("upsert_project", {
      p_id: (projectId ?? null) as unknown as string,
      p_name: name,
      p_budget_agorot: (agorot ?? null) as unknown as number,
      p_status: "active",
    });
    if (rpcError) {
      setError("לא הצלחנו לשמור את הפרויקט.");
      return;
    }
    await invalidate();
    onClose();
  }

  return (
    <form className="stack" onSubmit={(event) => { void submit(event); }}>
      <TextField label="שם" value={name} onChange={(event) => { setName(event.target.value); }} required />
      <MoneyField label="תקציב בשקלים, או ריק" value={budget} onChange={(event) => { setBudget(event.target.value); }} />
      {error ? <p className="form-error">{error}</p> : null}
      <Button type="submit">שמירה</Button>
      <Button variant="secondary" onClick={onClose}>ביטול</Button>
    </form>
  );
}

export function ProjectDetailScreen() {
  const preview = useHomePreview();
  const { projectId = "" } = useParams();
  const search = usePreviewSearch();
  const detail = useQuery({
    queryKey: ["project", preview, projectId],
    enabled: preview === "off",
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data, error } = await supabase.rpc("get_project", { p_id: projectId });
      if (error) throw error;
      return data as {
        id: string;
        name: string;
        status: string;
        state_label: string | null;
        budget_agorot: number | null;
        income_agorot: number;
        direct_agorot: number;
        shared_agorot: number;
        profit_agorot: number;
        categories: { id: string; name: string; amount_agorot: number }[];
        transactions: { id: string; description: string; doc_date: string; amount_net: number; direction: string; category: string | null }[];
      } | null;
    },
  });

  if (preview !== "off") return <LegacyEmptyProject />;
  if (detail.isLoading) return <ScreenMessage title="פרויקט" body="טוען…" loading />;
  if (!detail.data) {
    return <ScreenHeader title="פרויקט" subtitle="הפרויקט לא נמצא." backTo={`/projects${search}`} />;
  }
  const project = detail.data;
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
          <p className="band-label t-label">{project.state_label ?? (project.status === "finished" ? "הסתיים" : "פעיל")}</p>
          <p className="t-display"><BigNumber agorot={ag(project.profit_agorot)} /></p>
        </BandHero>
      </TopBand>
      {project.budget_agorot != null ? (
        <div className="page-pad">
          <BudgetBar label="תקציב" spentAgorot={ag(Math.abs(project.direct_agorot))} budgetAgorot={ag(project.budget_agorot)} />
        </div>
      ) : null}
      <StatGrid>
        <Stat label="הכנסות" amount={ag(project.income_agorot)} />
        <Stat label="עלויות ישירות" amount={ag(project.direct_agorot)} />
        <Stat label="חלק משותף" amount={ag(project.shared_agorot)} />
      </StatGrid>
      <h2 className="t-title-3 page-pad">קטגוריות</h2>
      {project.categories.length === 0 ? <p className="page-pad t-hint">אין עדיין הוצאות מסווגות.</p> : (
        <List>
          {project.categories.map((category) => (
            <ListRow key={category.id} variant="project" title={category.name} agorot={ag(category.amount_agorot)} loss={category.amount_agorot < 0} />
          ))}
        </List>
      )}
      <h2 className="t-title-3 page-pad">תנועות</h2>
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
              agorot={ag(txn.amount_net)}
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
          <p className="band-label t-label">רווח</p>
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
  budget: number | null;
  finished: boolean;
}) {
  const invalidate = useInvalidateBooks();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="page-pad">
      <Button variant="secondary" onClick={() => { setConfirm(true); }}>{finished ? "החזרה לפעיל" : "סיום הפרויקט"}</Button>
      <ConfirmSheet
        open={confirm}
        onOpenChange={setConfirm}
        title={finished ? "להחזיר את הפרויקט לפעיל?" : "לסיים את הפרויקט?"}
        item={name}
        consequence="פרויקט לא נמחק. אפשר להחזיר אותו אחר כך."
        confirmLabel="אישור"
        destructive={!finished}
        onConfirm={() => {
          const supabase = getSupabase();
          if (!supabase) return;
          void supabase.rpc("upsert_project", {
            p_id: projectId,
            p_name: name,
            p_budget_agorot: (budget ?? null) as unknown as number,
            p_status: finished ? "active" : "finished",
          }).then(() => invalidate());
          setConfirm(false);
        }}
      />
    </div>
  );
}

export function ReviewScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const review = useReviewQuery();
  const invalidate = useInvalidateBooks();
  if (preview === "empty") return <ReviewEmpty search={search} />;
  if (review.isLoading) return <ScreenMessage title="לאישור" body="טוען…" loading />;
  if (review.isError) return <ScreenMessage title="לאישור" body="לא הצלחנו לטעון את התור." />;
  return <ReviewQueue rows={review.data ?? []} search={search} preview={preview} invalidate={invalidate} />;
}

export function ReviewQueue({
  rows,
  search,
  preview = "off",
  invalidate = () => Promise.resolve(),
}: {
  rows: ReviewRow[];
  search: string;
  preview?: string;
  invalidate?: () => Promise<void>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [noteTone, setNoteTone] = useState<"ok" | "bad">("ok");
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => { setNote(null); }, 4000);
    return () => { window.clearTimeout(timer); };
  }, [note]);
  if (rows.length === 0) return <ReviewEmpty search={search} />;
  const row = rows[0];
  if (!row) return <ReviewEmpty search={search} />;
  const change = `/review/change${search}${search ? "&" : "?"}item=${row.id}`;
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="רק מה שה-AI לא היה בטוח בו" />
      <p className="t-label page-pad">{`1 מתוך ${String(rows.length)}`}</p>
      <ReviewCard
        supplier={row.supplier_name ?? row.description}
        date={formatDayMonth(row.doc_date)}
        netAgorot={ag(row.amount_net)}
        vatLine="לפני מע״מ"
        suggestion={row.reason ? <p className="t-label">{row.reason}</p> : undefined}
        actions={
          <>
            <Button
              full
              onClick={() => {
                void approve(row, invalidate, preview, (message, tone) => {
                  setNoteTone(tone);
                  setNote(message);
                });
              }}
            >
              אישור
            </Button>
            <Button variant="secondary" full to={change}>שינוי</Button>
            <Button
              variant="ghost"
              full
              onClick={() => {
                void skip(row.id, invalidate, preview).then(() => {
                  setNoteTone("ok");
                  setNote("דילגנו על הפריט");
                });
              }}
            >
              דלג
            </Button>
          </>
        }
      />
      {note ? <div className="page-pad"><Toast tone={noteTone}>{note}</Toast></div> : null}
    </div>
  );
}

function ReviewEmpty({ search }: { search: string }) {
  return (
    <div>
      <ScreenHeader title="לאישור" subtitle="רק מה שה-AI לא היה בטוח בו" />
      <EmptyState
        icon={<ReviewIcon />}
        title="הכל מאושר"
        body="אין פריטים שמחכים לך. מה שכבר ירד מ-SUMIT נשאר ברווח."
        action={<Button variant="pill" to={`/${search}`}>לדף הבית</Button>}
      />
    </div>
  );
}

async function approve(
  row: ReviewRow,
  invalidate: () => Promise<void>,
  preview: string,
  tell: (message: string, tone: "ok" | "bad") => void,
) {
  if (preview !== "off") return;
  if (!row.project_id || !row.category_id) {
    tell("בלי פרויקט וקטגוריה אי אפשר לאשר. בחרו בשינוי.", "bad");
    return;
  }
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.rpc("resolve_review", {
    p_id: row.id,
    p_action: "approved",
    p_project_id: row.project_id,
    p_category_id: row.category_id,
  });
  if (error) {
    tell("לא הצלחנו לאשר. נסו שוב.", "bad");
    return;
  }
  tell("הפריט אושר", "ok");
  await invalidate();
}

async function skip(id: string, invalidate: () => Promise<void>, preview: string) {
  if (preview !== "off") return;
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.rpc("resolve_review", {
    p_id: id,
    p_action: "skipped",
    p_project_id: null as unknown as string,
    p_category_id: null as unknown as string,
  });
  await invalidate();
}

export function ChangeForm() {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const dashboard = useDashboardQuery();
  const categories = useCategoriesQuery();
  const invalidate = useInvalidateBooks();
  const [params] = useSearchParams();
  const item = params.get("item") ?? "";
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (preview !== "off") {
      setError("במצב תצוגה זה לא נשמר.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase || !item) return;
    const { error: rpcError } = await supabase.rpc("resolve_review", {
      p_id: item,
      p_action: "changed",
      p_project_id: projectId,
      p_category_id: categoryId,
    });
    if (rpcError) {
      setError("בחרו פרויקט וקטגוריה.");
      return;
    }
    await invalidate();
  }

  return (
    <RouteSheet title="שינוי שיוך" closeTo={`/review${search}`}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <SelectField
          label="פרויקט"
          value={projectId}
          required
          onChange={(event) => { setProjectId(event.target.value); }}
          options={[{ value: "", label: "בחירה" }, ...(dashboard.data?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))]}
        />
        <SelectField
          label="קטגוריה"
          value={categoryId}
          required
          onChange={(event) => { setCategoryId(event.target.value); }}
          options={[{ value: "", label: "בחירה" }, ...(categories.data ?? []).filter((category) => !category.hidden).map((category) => ({ value: category.id, label: category.name }))]}
        />
        {error ? <p className="form-error">{error}</p> : null}
        <Button type="submit">אישור</Button>
      </form>
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

export function UnpaidScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const unpaid = useUnpaidQuery();
  if (preview === "empty") return <ScreenHeader title="חשבוניות פתוחות" backTo={`/${search}`} />;
  if (unpaid.isLoading) return <ScreenMessage title="חשבוניות פתוחות" body="טוען…" loading />;
  const rows = unpaid.data ?? [];
  const gross = rows.reduce((sum, row) => sum + row.open_gross_agorot, 0);
  return (
    <div>
      <ScreenHeader
        title="חשבוניות פתוחות"
        subtitle={`לא נכלל ברווח. סכום פתוח כולל מע״מ ${formatIls(ag(gross))}.`}
        backTo={`/${search}`}
      />
      {rows.length === 0 ? <EmptyState icon={<DocumentIcon />} title="אין חשבוניות פתוחות" body="כל החשבוניות כוסו בקבלה או בזיכוי." /> : (
        <List>
          {rows.map((row) => (
            <ListRow
              key={row.id}
              variant="transaction"
              title={row.customer_name ?? row.description}
              hint={[row.description, row.project_name, formatDayMonth(row.doc_date)].filter((part) => part != null && part !== "").join(" · ")}
              agorot={ag(row.open_gross_agorot)}
              sign="in"
              source="invoice"
            />
          ))}
        </List>
      )}
    </div>
  );
}

export function TransactionScreen() {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const navigate = useNavigate();
  const invalidate = useInvalidateBooks();
  const [confirm, setConfirm] = useState(false);
  const detail = useQuery({
    queryKey: ["txn", preview, transactionId],
    enabled: preview === "off",
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const { data, error } = await supabase.rpc("get_transaction", { p_id: transactionId });
      if (error) throw error;
      return data as null | {
        id: string;
        description: string;
        direction: string;
        doc_date: string;
        amount_gross: number;
        amount_net: number;
        vat_amount: number;
        vat_status: string;
        source: string;
        project_name: string | null;
        category_name: string | null;
        supplier_name: string | null;
        customer_name: string | null;
      };
    },
  });
  if (preview !== "off") {
    return <ScreenHeader title="פרטי תנועה" backTo={`/${search}`} />;
  }
  if (detail.isLoading) return <ScreenMessage title="פרטי תנועה" body="טוען…" loading />;
  if (!detail.data) return <ScreenMessage title="פרטי תנועה" body="התנועה לא נמצאה." />;
  const txn = detail.data;
  return (
    <div>
      <ScreenHeader title="פרטי תנועה" backTo={`/${search}`} />
      <p className="t-display page-pad"><BigNumber agorot={ag(txn.amount_net)} /></p>
      <p className="page-pad">{txn.description}</p>
      <p className="t-hint page-pad">{formatDayMonth(txn.doc_date)} · {txn.project_name ?? "בלי פרויקט"} · {txn.category_name ?? "בלי קטגוריה"}</p>
      <p className="t-hint page-pad">לפני מע״מ. מע״מ <bdi dir="ltr">{formatIls(ag(txn.vat_amount))}</bdi> · {txn.vat_status === "assumed" ? "מע״מ משוער 18%" : txn.vat_status}</p>
      <p className="t-hint page-pad">{txn.supplier_name ?? txn.customer_name ?? ""}</p>
      <div className="stack page-pad">
        <Button variant="secondary" to={`/transactions/${txn.id}/split${search}`}>פיצול</Button>
        {txn.source === "manual" ? (
          <Button variant="danger" onClick={() => { setConfirm(true); }}>מחיקה</Button>
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
        onConfirm={() => {
          const supabase = getSupabase();
          if (!supabase) return;
          void supabase.rpc("delete_transaction", { p_id: txn.id }).then(async () => {
            await invalidate();
            void navigate(`/${search}`);
          });
        }}
      />
    </div>
  );
}

export function SplitScreen() {
  const { transactionId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const dashboard = useDashboardQuery();
  const projects = dashboard.data?.projects ?? [];
  const [shares, setShares] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidateBooks();
  const total = Object.values(shares).reduce((sum, value) => sum + (Number(value) || 0), 0);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (preview !== "off") {
      setError("במצב תצוגה הפיצול לא נשמר.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    const rows = Object.entries(shares)
      .filter(([, value]) => Number(value) > 0)
      .map(([project, value]) => ({ project_id: project, share_bp: Math.round(Number(value) * 100) }));
    const { error: rpcError } = await supabase.rpc("save_split", {
      p_transaction_id: transactionId,
      p_shares: rows,
    });
    if (rpcError) {
      setError("החלקים צריכים להסתכם ב-100%.");
      return;
    }
    await invalidate();
    setError(null);
  }

  return (
    <div>
      <ScreenHeader title="פיצול" subtitle={`החלקים מסתכמים ב-100%. עכשיו ${total.toFixed(0)}%.`} backTo={`/transactions/${transactionId}${search}`} />
      <form className="stack page-pad" onSubmit={(event) => { void save(event); }}>
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
        {error ? <p className="form-error">{error}</p> : null}
        <Button type="submit">שמירת הפיצול</Button>
      </form>
    </div>
  );
}

export function SettingsScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const { session } = useAuth();
  const status = useSumitStatusQuery();
  const dashboard = useDashboardQuery();
  const invalidate = useInvalidateBooks();
  const [companyId, setCompanyId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  if (preview === "empty") return <ScreenHeader title="הגדרות" />;

  async function connect(event: SubmitEvent) {
    event.preventDefault();
    if (preview !== "off") {
      setMessage("במצב תצוגה המפתח לא נשלח.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const base = import.meta.env.VITE_SUPABASE_URL as string;
    if (!token || !base) {
      setMessage("אין הפעלה מחוברת.");
      return;
    }
    const response = await fetch(`${base}/functions/v1/sumit-connect`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        "content-type": "application/json",
      },
      body: JSON.stringify({ companyId: Number(companyId), apiKey }),
    });
    setApiKey("");
    if (!response.ok) {
      setMessage("החיבור נכשל. בדקו את המזהה ואת המפתח.");
      return;
    }
    setMessage("SUMIT מחובר. המפתח נשאר בשרת.");
    await invalidate();
  }

  async function refresh() {
    if (preview !== "off") {
      setMessage("במצב תצוגה אין קריאה ל-SUMIT.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
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
    setMessage(response.ok ? "הרענון הסתיים." : "הרענון נכשל.");
    await invalidate();
  }

  async function disconnect() {
    if (preview !== "off") return;
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.rpc("disconnect_sumit");
    setMessage("החיבור נותק. הספרים נשארו.");
    await invalidate();
  }

  const connected = status.data?.connected === true;
  return (
    <div>
      <ScreenHeader title="הגדרות" />
      <section className="page-pad stack">
        <h2 className="t-title-3">העסק</h2>
        <p>{dashboard.data?.name ?? "עדיין בלי עסק"}</p>
        <p className="t-hint">{dashboard.data?.vat_registered === false ? "עוסק פטור" : "עוסק מורשה"}</p>
      </section>
      <section className="page-pad stack">
        <h2 className="t-title-3">חשבון Google</h2>
        <p>{session?.user.email ?? "לא מחובר"}</p>
        {preview === "off" ? (
          <Button
            variant="secondary"
            onClick={() => {
              const supabase = getSupabase();
              void supabase?.auth.signOut();
            }}
          >
            יציאה
          </Button>
        ) : null}
      </section>
      <section className="page-pad stack">
        <h2 className="t-title-3">SUMIT</h2>
        <p>{connected ? `מחובר לחברה ${String(status.data?.sumit_company_id ?? "")}` : "לא מחובר"}</p>
        {status.data?.last_error ? <p className="form-error">{status.data.last_error}</p> : null}
        <form className="stack" onSubmit={(event) => { void connect(event); }}>
          <TextField label="CompanyID" value={companyId} inputMode="numeric" onChange={(event) => { setCompanyId(event.target.value); }} />
          <TextField label="מפתח API" type="password" value={apiKey} autoComplete="off" onChange={(event) => { setApiKey(event.target.value); }} />
          <Button type="submit">חיבור</Button>
        </form>
        <Button variant="secondary" onClick={() => { void refresh(); }}>רענון עכשיו</Button>
        {connected ? <Button variant="secondary" onClick={() => { void disconnect(); }}>ניתוק</Button> : null}
        {message ? <p className="t-label">{message}</p> : null}
      </section>
      <nav className="stack page-pad">
        <TextLink to={`/settings/categories${search}`}>קטגוריות</TextLink>
        <TextLink to={`/projects${search}`}>פרויקטים</TextLink>
        <TextLink to={`/notifications${search}`}>התראות</TextLink>
      </nav>
    </div>
  );
}

export function CategoriesScreen() {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const categories = useCategoriesQuery();
  const invalidate = useInvalidateBooks();
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  if (preview === "empty") return <ScreenHeader title="קטגוריות" backTo={`/settings${search}`} />;
  return (
    <div>
      <ScreenHeader title="קטגוריות" backTo={`/settings${search}`} />
      <List>
        {(categories.data ?? []).map((category) => (
          <ListRow
            key={category.id}
            variant="item"
            title={category.name}
            hint={`${category.kind === "income" ? "הכנסה" : "הוצאה"}${category.hidden ? " · מוסתרת" : ""}`}
            action={
              <Button
                variant="pill"
                onClick={() => {
                  if (preview !== "off") return;
                  const supabase = getSupabase();
                  if (!supabase) return;
                  void supabase.rpc("set_category_hidden", { p_id: category.id, p_hidden: !category.hidden }).then(() => invalidate());
                }}
              >
                {category.hidden ? "הצגה" : "הסתרה"}
              </Button>
            }
          />
        ))}
      </List>
      <form
        className="stack page-pad"
        onSubmit={(event) => {
          event.preventDefault();
          if (preview !== "off") return;
          const supabase = getSupabase();
          if (!supabase) return;
          void supabase.rpc("merge_category", { p_from: mergeFrom, p_into: mergeInto }).then(() => invalidate());
        }}
      >
        <h2 className="t-title-3">מיזוג</h2>
        <SelectField
          label="מקטגוריה"
          value={mergeFrom}
          onChange={(event) => { setMergeFrom(event.target.value); }}
          options={[{ value: "", label: "בחירה" }, ...(categories.data ?? []).map((category) => ({ value: category.id, label: category.name }))]}
        />
        <SelectField
          label="אל"
          value={mergeInto}
          onChange={(event) => { setMergeInto(event.target.value); }}
          options={[{ value: "", label: "בחירה" }, ...(categories.data ?? []).filter((category) => !category.hidden).map((category) => ({ value: category.id, label: category.name }))]}
        />
        <Button type="submit">מיזוג</Button>
      </form>
    </div>
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
      <p className="t-hint page-pad">בשלב הזה ההודעות לא נשלחות. אין שירות בתשלום ואין Push.</p>
    </div>
  );
}
