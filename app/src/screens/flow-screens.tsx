import { formatIls, shekelsToAgorot } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { addTriggerRef } from "../add-trigger";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { withSheetBackground } from "../sheet-background";
import {
  useCategoriesQuery,
  useDashboardQuery,
  useInvalidateBooks,
  useReviewQuery,
  useSumitStatusQuery,
  useUnpaidQuery,
} from "../use-books";
import { Banner } from "../ui/banner";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { Card, Section } from "../ui/card";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { DatePicker } from "../ui/date-picker";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { BackIcon, CameraIcon, DocumentIcon } from "../ui/icons";
import { BandHero } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { MoneyField } from "../ui/money-field";
import { BudgetBar } from "../ui/progress-bar";
import { ScreenHeader } from "../ui/screen-header";
import { SegmentedControl } from "../ui/segmented-control";
import { SelectField } from "../ui/select-field";
import { Sheet } from "../ui/sheet";
import { RouteSheet } from "../ui/route-sheet";
import { Loader } from "../ui/skeleton";
import { Stat, StatGrid } from "../ui/stat";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { Toggle } from "../ui/toggle";
import { TopBand } from "../ui/top-band";

function ag(value: number): bigint {
  return BigInt(Math.trunc(value));
}

function ScreenMessage({ title, body, loading = false }: { title: string; body: string; loading?: boolean }) {
  return (
    <>
      <ScreenHeader title={title} />
      {loading ? <Loader label={body} /> : <p className="t-label page-pad text-text-secondary">{body}</p>}
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
  const [open, setOpen] = useState(false);
  if (preview === "empty") return <ScreenHeader title="פרויקטים" />;
  if (dashboard.isLoading) return <ScreenMessage title="פרויקטים" body="טוען…" loading />;
  if (dashboard.isError || !dashboard.data) return <ScreenMessage title="פרויקטים" body="לא הצלחנו לטעון את הפרויקטים." />;
  const projects = dashboard.data.projects;
  return (
    <div>
      <ScreenHeader title="פרויקטים" />
      <div className="page-pad">
        <Button variant="secondary" onClick={() => { setOpen(true); }}>פרויקט חדש</Button>
      </div>
      {projects.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין עדיין פרויקטים" body="פרויקט נוצר מסעיף תקציב ב-SUMIT, או מכאן." />
      ) : (
        <List>
          {projects.map((project) => (
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
    enabled: preview === "off" || preview === "demo",
    queryFn: async () => {
      if (preview === "demo") {
        const model = await import("../demo/model");
        return model.demoProject(projectId);
      }
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

  if (preview !== "off" && preview !== "demo") return <LegacyEmptyProject />;
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
              hint={`${txn.doc_date}${txn.category ? ` · ${txn.category}` : ""}`}
              agorot={ag(txn.amount_net)}
              sign={txn.direction === "income" ? "in" : "out"}
              source="invoice"
              href={`/transactions/${txn.id}${search}`}
            />
          ))}
        </List>
      )}
      {preview === "off" ? (
        <ArchiveButton projectId={project.id} name={project.name} budget={project.budget_agorot ?? null} finished={project.status === "finished"} />
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
          <Button variant="secondary" to={`/add${search}`} state={withSheetBackground(location)}>
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
        title={finished ? "החזרה לפעיל" : "סיום הפרויקט"}
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
  if (preview === "empty") return <ScreenHeader title="לאישור" />;
  if (review.isLoading) return <ScreenMessage title="לאישור" body="טוען…" loading />;
  if (review.isError) return <ScreenMessage title="לאישור" body="לא הצלחנו לטעון את התור." />;
  const rows = review.data ?? [];
  return (
    <div>
      <ScreenHeader title="לאישור" />
      {rows.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין פריטים לאישור" body="כשחסר פרויקט או קטגוריה, הפריט מופיע כאן. הרווח כבר כולל את מה שירד מ-SUMIT." />
      ) : (
        <div className="stack">
          {rows.map((row) => (
            <Card key={row.id}>
              <ListRow variant="review" title={row.description} hint={`${row.supplier_name ?? "בלי ספק"} · ${row.doc_date}`} agorot={ag(row.amount_net)} status="ממתין" />
              <div className="choice-col">
                <Button variant="secondary" to={`/review/change${search}${search ? "&" : "?"}item=${row.id}`}>שינוי</Button>
                <Button variant="secondary" onClick={() => { void skip(row.id, invalidate, preview); }}>דילוג</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
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
  const preview = useHomePreview();
  const dashboard = useDashboardQuery();
  const categories = useCategoriesQuery();
  const invalidate = useInvalidateBooks();
  const [direction, setDirection] = useState<"income" | "expense">("expense");
  const [kind, setKind] = useState<"payment" | "invoice">("payment");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [exempt, setExempt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!date) {
      setError("בדקו סכום, תאריך ופרויקט.");
      return;
    }
    if (preview !== "off") {
      setError("במצב תצוגה הרשומה לא נשמרת.");
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    const gross = shekelsToAgorot(amount);
    const { error: rpcError } = await supabase.rpc("create_manual_entry", {
      p_direction: direction,
      p_kind: direction === "income" ? kind : "expense",
      p_gross_agorot: Number(gross < 0n ? -gross : gross),
      p_doc_date: date,
      p_description: description,
      p_project_id: (projectId || null) as unknown as string,
      p_category_id: (categoryId || null) as unknown as string,
      p_vat_exempt: exempt,
    });
    if (rpcError) {
      setError("בדקו סכום, תאריך ופרויקט.");
      return;
    }
    await invalidate();
    setAmount("");
    setDescription("");
    setError(null);
  }

  return (
    <RouteSheet title="הוספה" closeTo={`/${search}`} returnFocusRef={addTriggerRef}>
      <form className="stack" onSubmit={(event) => { void save(event); }}>
        <SegmentedControl
          label="סוג"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "income", label: "הכנסה" },
            { value: "expense", label: "הוצאה" },
          ]}
        />
        {direction === "income" ? (
          <SegmentedControl
            label="מסמך"
            value={kind}
            onChange={setKind}
            options={[
              { value: "payment", label: "תקבול" },
              { value: "invoice", label: "חשבונית שלא שולמה" },
            ]}
          />
        ) : (
          <Toggle label="הספק פטור ממע״מ" checked={exempt} onChange={setExempt} />
        )}
        <MoneyField label="סכום בשקלים" value={amount} onChange={(event) => { setAmount(event.target.value); }} required />
        <DatePicker label="תאריך" value={date} onChange={setDate} />
        <TextField label="תיאור" value={description} onChange={(event) => { setDescription(event.target.value); }} />
        <SelectField
          label="פרויקט"
          value={projectId}
          onChange={(event) => { setProjectId(event.target.value); }}
          options={[{ value: "", label: "בלי פרויקט, זו תקורה" }, ...(dashboard.data?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))]}
        />
        <SelectField
          label="קטגוריה"
          value={categoryId}
          onChange={(event) => { setCategoryId(event.target.value); }}
          options={[
            { value: "", label: "בלי קטגוריה" },
            ...(categories.data ?? [])
              .filter((category) => category.kind === (direction === "income" ? "income" : "expense") && !category.hidden)
              .map((category) => ({ value: category.id, label: category.name })),
          ]}
        />
        {error ? <p className="form-error">{error}</p> : null}
        <Button type="submit">שמירה</Button>
      </form>
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
              hint={`${row.project_name ?? ""} · ${row.doc_date}`}
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
    enabled: preview === "off" || preview === "demo",
    queryFn: async () => {
      if (preview === "demo") {
        const model = await import("../demo/model");
        return model.demoTransaction(transactionId);
      }
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
  if (preview !== "off" && preview !== "demo") {
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
      <p className="t-hint page-pad">{txn.doc_date} · {txn.project_name ?? "בלי פרויקט"} · {txn.category_name ?? "בלי קטגוריה"}</p>
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
        title="מחיקת רשומה"
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
      <Section title="העסק">
        <p>{dashboard.data?.name ?? "עדיין בלי עסק"}</p>
        <p className="t-hint">{dashboard.data?.vat_registered === false ? "עוסק פטור" : "עוסק מורשה"}</p>
      </Section>
      <Section title="חשבון Google">
        <p>{session?.user.email ?? (preview === "demo" ? "eliranazulay@gmail.com" : "לא מחובר")}</p>
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
      </Section>
      <Section title="SUMIT">
        <p>{connected ? `מחובר לחברה ${String(status.data?.sumit_company_id ?? "")}` : "לא מחובר"}</p>
        {status.data?.last_error ? <p className="form-error">{status.data.last_error}</p> : null}
        <form className="stack" onSubmit={(event) => { void connect(event); }}>
          <TextField label="CompanyID" value={companyId} inputMode="numeric" onChange={(event) => { setCompanyId(event.target.value); }} />
          <TextField label="מפתח API" type="password" value={apiKey} autoComplete="off" onChange={(event) => { setApiKey(event.target.value); }} />
          <Button type="submit">חיבור</Button>
        </form>
        <Button variant="secondary" onClick={() => { void refresh(); }}>רענון עכשיו</Button>
        {connected ? <Button variant="danger" onClick={() => { void disconnect(); }}>ניתוק</Button> : null}
        {message ? <Banner title={message} /> : null}
      </Section>
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
            variant="supplier"
            title={category.name}
            hint={`${category.kind === "income" ? "הכנסה" : "הוצאה"}${category.hidden ? " · מוסתרת" : ""}`}
            action={
              <Button
                variant="secondary"
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
      <Card>
        <form
          className="stack"
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
          <Button type="submit" variant="danger">מיזוג והסתרה</Button>
        </form>
      </Card>
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
