import { formatIls, shekelsToAgorot } from "@flow/shared";
import { useQuery } from "@tanstack/react-query";
import { useState, type SubmitEvent } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { EmptyState } from "../components/EmptyState";
import { Money } from "../components/Money";
import { PageTitle } from "../components/PageTitle";
import { Sheet } from "../components/Sheet";
import { BackIcon, CameraIcon, DocumentIcon } from "../components/icons";
import { withSheetBackground } from "../sheet-background";
import { addTriggerRef } from "../add-trigger";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import {
  useCategoriesQuery,
  useDashboardQuery,
  useInvalidateBooks,
  useReviewQuery,
  useSumitStatusQuery,
  useUnpaidQuery,
} from "../use-books";

function ag(value: number): bigint {
  return BigInt(Math.trunc(value));
}

function ScreenMessage({ title, body }: { title: string; body: string }) {
  return (
    <div className="page">
      <h1 className="t-title-1">{title}</h1>
      <p className="t-label text-text-secondary">{body}</p>
    </div>
  );
}

export function OnboardingScreen() {
  const navigate = useNavigate();
  const preview = useHomePreview();
  const [name, setName] = useState("");
  const [vat, setVat] = useState(true);
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
      p_vat_registered: vat,
    });
    setPending(false);
    if (rpcError) {
      setError(rpcError.message.includes("already") ? "כבר יש עסק על החשבון." : "לא הצלחנו לשמור. נסו שוב.");
      return;
    }
    void navigate("/", { replace: true });
  }

  return (
    <main className="page">
      <h1 className="t-title-1">פרטי העסק</h1>
      <p className="t-label text-text-secondary">השם שיופיע בבית, ומצב המע״מ.</p>
      <form className="stack" onSubmit={(event) => { void submit(event); }}>
        <label className="field">
          שם העסק
          <input value={name} onChange={(event) => { setName(event.target.value); }} required minLength={2} />
        </label>
        <fieldset className="choice-col">
          <legend className="t-label">מצב מע״מ</legend>
          <label><input type="radio" name="vat" checked={vat} onChange={() => { setVat(true); }} /> עוסק מורשה, 18%</label>
          <label><input type="radio" name="vat" checked={!vat} onChange={() => { setVat(false); }} /> עוסק פטור</label>
        </fieldset>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn-pri" disabled={pending}>המשך</button>
      </form>
    </main>
  );
}

export function ProjectsScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const dashboard = useDashboardQuery();
  const [open, setOpen] = useState(false);
  if (preview === "empty") {
    return <PageTitle title="פרויקטים" />;
  }
  if (dashboard.isLoading) return <ScreenMessage title="פרויקטים" body="טוען…" />;
  if (dashboard.isError || !dashboard.data) return <ScreenMessage title="פרויקטים" body="לא הצלחנו לטעון את הפרויקטים." />;
  const projects = dashboard.data.projects;
  return (
    <div className="page">
      <div className="section-head">
        <h1 className="t-title-1">פרויקטים</h1>
        <button type="button" className="btn-sec" onClick={() => { setOpen(true); }}>פרויקט חדש</button>
      </div>
      {projects.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין עדיין פרויקטים" body="פרויקט נוצר מסעיף תקציב ב-SUMIT, או מכאן." />
      ) : (
        <ul className="project-list">
          {projects.map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}${search}`} className="project-line">
                <span>
                  {project.name}
                  <span className="t-hint block">{project.status === "finished" ? "הסתיים" : "פעיל"}</span>
                </span>
                <Money agorot={ag(project.profit_agorot)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open ? <ProjectForm onClose={() => { setOpen(false); }} /> : null}
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
    <form className="stack card" onSubmit={(event) => { void submit(event); }}>
      <h2 className="t-title-3">פרויקט</h2>
      <label className="field">שם<input value={name} onChange={(event) => { setName(event.target.value); }} required /></label>
      <label className="field">תקציב בשקלים, או ריק<input value={budget} onChange={(event) => { setBudget(event.target.value); }} inputMode="decimal" /></label>
      {error ? <p className="form-error">{error}</p> : null}
      <button type="submit" className="btn-pri">שמירה</button>
      <button type="button" className="btn-sec" onClick={onClose}>ביטול</button>
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

  if (preview !== "off" && preview !== "demo") {
    return <LegacyEmptyProject />;
  }
  if (detail.isLoading) return <ScreenMessage title="פרויקט" body="טוען…" />;
  if (!detail.data) {
    return (
      <div className="page">
        <Link to={`/projects${search}`} aria-label="חזרה" className="icon-btn"><BackIcon /></Link>
        <h1 className="t-title-1">פרויקט</h1>
        <p className="t-label">הפרויקט לא נמצא.</p>
      </div>
    );
  }
  const project = detail.data;
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="band">
        <div className="band-row">
          <Link to={`/projects${search}`} aria-label="חזרה" className="icon-btn icon-btn-on-band"><BackIcon /></Link>
        </div>
        <div className="band-hero">
          <h1 className="t-title-2">{project.name}</h1>
          <p className="band-label t-label">{project.state_label ?? (project.status === "finished" ? "הסתיים" : "פעיל")}</p>
          <p className="t-display"><Money agorot={ag(project.profit_agorot)} /></p>
        </div>
      </header>
      {project.budget_agorot != null ? (
        <p className="page-pad t-label">תקציב <Money agorot={ag(project.budget_agorot)} /></p>
      ) : null}
      <div className="stat-grid">
        <div className="stat"><p className="t-hint">הכנסות</p><Money agorot={ag(project.income_agorot)} /></div>
        <div className="stat"><p className="t-hint">עלויות ישירות</p><Money agorot={ag(project.direct_agorot)} /></div>
        <div className="stat"><p className="t-hint">חלק משותף</p><Money agorot={ag(project.shared_agorot)} /></div>
      </div>
      <h2 className="t-title-3 page-pad">קטגוריות</h2>
      {project.categories.length === 0 ? <p className="page-pad t-hint">אין עדיין הוצאות מסווגות.</p> : (
        <ul className="project-list">
          {project.categories.map((category) => (
            <li key={category.id} className="project-line">
              <span>{category.name}</span>
              <Money agorot={ag(category.amount_agorot)} />
            </li>
          ))}
        </ul>
      )}
      <h2 className="t-title-3 page-pad">תנועות</h2>
      {project.transactions.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין עדיין תנועות" body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן." />
      ) : (
        <ul className="project-list">
          {project.transactions.map((txn) => (
            <li key={txn.id}>
              <Link to={`/transactions/${txn.id}${search}`} className="project-line">
                <span>{txn.description}<span className="t-hint block">{txn.doc_date}{txn.category ? ` · ${txn.category}` : ""}</span></span>
                <Money agorot={ag(txn.amount_net)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {preview === "off" ? (
        <ArchiveButton
          projectId={project.id}
          name={project.name}
          budget={project.budget_agorot ?? null}
          finished={project.status === "finished"}
        />
      ) : null}
    </div>
  );
}

function LegacyEmptyProject() {
  const search = usePreviewSearch();
  const location = useLocation();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="band">
        <div className="band-row">
          <Link to={`/projects${search}`} aria-label="חזרה" className="icon-btn icon-btn-on-band"><BackIcon /></Link>
        </div>
        <div className="band-hero">
          <h1 className="t-title-2">פרויקט</h1>
          <p className="band-label t-label">רווח</p>
          <p className="t-display"><Money agorot={0n} /></p>
        </div>
      </header>
      <EmptyState
        icon={<DocumentIcon />}
        title="אין עדיין תנועות"
        body="חשבוניות ותשלומים שישויכו לפרויקט הזה יופיעו כאן."
        action={
          <Link to={`/add${search}`} state={withSheetBackground(location)} className="btn-sec">
            <CameraIcon />
            צילום חשבונית
          </Link>
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
  if (!confirm) {
    return <button type="button" className="btn-sec page-pad" onClick={() => { setConfirm(true); }}>{finished ? "החזרה לפעיל" : "סיום הפרויקט"}</button>;
  }
  return (
    <div className="card page-pad">
      <p>פרויקט לא נמחק. אפשר להחזיר אותו אחר כך.</p>
      <button
        type="button"
        className="btn-bad"
        onClick={() => {
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
      >
        אישור
      </button>
    </div>
  );
}

export function ReviewScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const review = useReviewQuery();
  const invalidate = useInvalidateBooks();
  if (preview === "empty") return <PageTitle title="לאישור" />;
  if (review.isLoading) return <ScreenMessage title="לאישור" body="טוען…" />;
  if (review.isError) return <ScreenMessage title="לאישור" body="לא הצלחנו לטעון את התור." />;
  const rows = review.data ?? [];
  return (
    <div className="page">
      <h1 className="t-title-1">לאישור</h1>
      {rows.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין פריטים לאישור" body="כשחסר פרויקט או קטגוריה, הפריט מופיע כאן. הרווח כבר כולל את מה שירד מ-SUMIT." />
      ) : (
        <ul className="stack">
          {rows.map((row) => (
            <li key={row.id} className="card">
              <p className="t-title-3">{row.description}</p>
              <p className="t-hint">{row.supplier_name ?? "בלי ספק"} · {row.doc_date}</p>
              <p><Money agorot={ag(row.amount_net)} /></p>
              <div className="choice-col">
                <Link className="btn-sec" to={`/review/change${search}${search ? "&" : "?"}item=${row.id}`}>שינוי</Link>
                <button type="button" className="btn-sec" onClick={() => { void skip(row.id, invalidate, preview); }}>דילוג</button>
              </div>
            </li>
          ))}
        </ul>
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
    <Sheet title="שינוי שיוך" closeTo={`/review${search}`}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="field">פרויקט
          <select value={projectId} onChange={(event) => { setProjectId(event.target.value); }} required>
            <option value="">בחירה</option>
            {(dashboard.data?.projects ?? []).map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>
        <label className="field">קטגוריה
          <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); }} required>
            <option value="">בחירה</option>
            {(categories.data ?? []).filter((category) => !category.hidden).map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn-pri">אישור</button>
      </form>
    </Sheet>
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
  const [date, setDate] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [exempt, setExempt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: SubmitEvent) {
    event.preventDefault();
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
    <Sheet title="הוספה" closeTo={`/${search}`} returnFocusRef={addTriggerRef}>
      <form className="stack" onSubmit={(event) => { void save(event); }}>
        <div className="seg" role="group" aria-label="סוג">
          <button type="button" aria-pressed={direction === "income"} onClick={() => { setDirection("income"); }}>הכנסה</button>
          <button type="button" aria-pressed={direction === "expense"} onClick={() => { setDirection("expense"); }}>הוצאה</button>
        </div>
        {direction === "income" ? (
          <div className="seg" role="group" aria-label="מסמך">
            <button type="button" aria-pressed={kind === "payment"} onClick={() => { setKind("payment"); }}>תקבול</button>
            <button type="button" aria-pressed={kind === "invoice"} onClick={() => { setKind("invoice"); }}>חשבונית שלא שולמה</button>
          </div>
        ) : (
          <label className="field"><input type="checkbox" checked={exempt} onChange={(event) => { setExempt(event.target.checked); }} /> הספק פטור ממע״מ</label>
        )}
        <label className="field">סכום בשקלים<input value={amount} onChange={(event) => { setAmount(event.target.value); }} inputMode="decimal" required /></label>
        <label className="field">תאריך<input type="date" value={date} onChange={(event) => { setDate(event.target.value); }} required /></label>
        <label className="field">תיאור<input value={description} onChange={(event) => { setDescription(event.target.value); }} /></label>
        <label className="field">פרויקט
          <select value={projectId} onChange={(event) => { setProjectId(event.target.value); }}>
            <option value="">בלי פרויקט, זו תקורה</option>
            {(dashboard.data?.projects ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="field">קטגוריה
          <select value={categoryId} onChange={(event) => { setCategoryId(event.target.value); }}>
            <option value="">בלי קטגוריה</option>
            {(categories.data ?? []).filter((category) => category.kind === (direction === "income" ? "income" : "expense") && !category.hidden).map((category) => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn-pri">שמירה</button>
      </form>
    </Sheet>
  );
}

export function UnpaidScreen() {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const unpaid = useUnpaidQuery();
  if (preview === "empty") return <PageTitle title="חשבוניות פתוחות" backTo={`/${search}`} />;
  if (unpaid.isLoading) return <ScreenMessage title="חשבוניות פתוחות" body="טוען…" />;
  const rows = unpaid.data ?? [];
  const gross = rows.reduce((sum, row) => sum + row.open_gross_agorot, 0);
  return (
    <div className="page">
      <Link to={`/${search}`} aria-label="חזרה" className="icon-btn"><BackIcon /></Link>
      <h1 className="t-title-1">חשבוניות פתוחות</h1>
      <p className="t-label">לא נכלל ברווח. סכום פתוח כולל מע״מ <bdi dir="ltr">{formatIls(ag(gross))}</bdi>.</p>
      {rows.length === 0 ? <EmptyState icon={<DocumentIcon />} title="אין חשבוניות פתוחות" body="כל החשבוניות כוסו בקבלה או בזיכוי." /> : (
        <ul className="project-list">
          {rows.map((row) => (
            <li key={row.id} className="project-line">
              <span>{row.customer_name ?? row.description}<span className="t-hint block">{row.project_name} · {row.doc_date}</span></span>
              <Money agorot={ag(row.open_gross_agorot)} />
            </li>
          ))}
        </ul>
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
    return (
      <div className="page">
        <Link to={`/${search}`} aria-label="חזרה" className="icon-btn"><BackIcon /></Link>
        <h1 className="t-title-1">פרטי תנועה</h1>
      </div>
    );
  }
  if (detail.isLoading) return <ScreenMessage title="פרטי תנועה" body="טוען…" />;
  if (!detail.data) return <ScreenMessage title="פרטי תנועה" body="התנועה לא נמצאה." />;
  const txn = detail.data;
  return (
    <div className="page">
      <Link to={`/${search}`} aria-label="חזרה" className="icon-btn"><BackIcon /></Link>
      <h1 className="t-title-1">פרטי תנועה</h1>
      <p className="t-display"><Money agorot={ag(txn.amount_net)} /></p>
      <p>{txn.description}</p>
      <p className="t-hint">{txn.doc_date} · {txn.project_name ?? "בלי פרויקט"} · {txn.category_name ?? "בלי קטגוריה"}</p>
      <p className="t-hint">לפני מע״מ. מע״מ <bdi dir="ltr">{formatIls(ag(txn.vat_amount))}</bdi> · {txn.vat_status === "assumed" ? "מע״מ משוער 18%" : txn.vat_status}</p>
      <p className="t-hint">{txn.supplier_name ?? txn.customer_name ?? ""}</p>
      <Link className="btn-sec" to={`/transactions/${txn.id}/split${search}`}>פיצול</Link>
      {txn.source === "manual" ? (
        <button type="button" className="btn-bad" onClick={() => { setConfirm(true); }}>מחיקה</button>
      ) : (
        <p className="t-hint">תנועה מ-SUMIT לא נמחקת כאן. היא מתעדכנת בסנכרון.</p>
      )}
      {confirm ? (
        <div className="card" role="dialog" aria-label="אישור מחיקה">
          <p>למחוק את הרשומה הידנית? אי אפשר לשחזר.</p>
          <button
            type="button"
            className="btn-bad"
            onClick={() => {
              const supabase = getSupabase();
              if (!supabase) return;
              void supabase.rpc("delete_transaction", { p_id: txn.id }).then(async () => {
                await invalidate();
                void navigate(`/${search}`);
              });
            }}
          >
            מחיקה
          </button>
          <button type="button" className="btn-sec" onClick={() => { setConfirm(false); }}>ביטול</button>
        </div>
      ) : null}
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
    <div className="page">
      <Link to={`/transactions/${transactionId}${search}`} aria-label="חזרה" className="icon-btn"><BackIcon /></Link>
      <h1 className="t-title-1">פיצול</h1>
      <p className="t-label">החלקים מסתכמים ב-100%. עכשיו {total.toFixed(0)}%.</p>
      <form className="stack" onSubmit={(event) => { void save(event); }}>
        {projects.map((project) => (
          <label key={project.id} className="field">
            {project.name}
            <input
              inputMode="decimal"
              value={shares[project.id] ?? ""}
              onChange={(event) => { setShares({ ...shares, [project.id]: event.target.value }); }}
              placeholder="0"
            />
          </label>
        ))}
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn-pri">שמירת הפיצול</button>
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
  if (preview === "empty") return <PageTitle title="הגדרות" />;

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
    <div className="page">
      <h1 className="t-title-1">הגדרות</h1>
      <section className="card">
        <h2 className="t-title-3">העסק</h2>
        <p>{dashboard.data?.name ?? "עדיין בלי עסק"}</p>
        <p className="t-hint">{dashboard.data?.vat_registered === false ? "עוסק פטור" : "עוסק מורשה"}</p>
      </section>
      <section className="card">
        <h2 className="t-title-3">חשבון Google</h2>
        <p>{session?.user.email ?? (preview === "demo" ? "eliranazulay@gmail.com" : "לא מחובר")}</p>
        {preview === "off" ? (
          <button
            type="button"
            className="btn-sec"
            onClick={() => {
              const supabase = getSupabase();
              void supabase?.auth.signOut();
            }}
          >
            יציאה
          </button>
        ) : null}
      </section>
      <section className="card">
        <h2 className="t-title-3">SUMIT</h2>
        <p>{connected ? `מחובר לחברה ${String(status.data?.sumit_company_id ?? "")}` : "לא מחובר"}</p>
        {status.data?.last_error ? <p className="form-error">{status.data.last_error}</p> : null}
        <form className="stack" onSubmit={(event) => { void connect(event); }}>
          <label className="field">CompanyID<input value={companyId} onChange={(event) => { setCompanyId(event.target.value); }} inputMode="numeric" /></label>
          <label className="field">מפתח API<input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); }} autoComplete="off" /></label>
          <button type="submit" className="btn-pri">חיבור</button>
        </form>
        <button type="button" className="btn-sec" onClick={() => { void refresh(); }}>רענון עכשיו</button>
        {connected ? <button type="button" className="btn-bad" onClick={() => { void disconnect(); }}>ניתוק</button> : null}
        {message ? <p className="t-hint">{message}</p> : null}
      </section>
      <nav className="stack">
        <Link to={`/settings/categories${search}`}>קטגוריות</Link>
        <Link to={`/projects${search}`}>פרויקטים</Link>
        <Link to={`/notifications${search}`}>התראות</Link>
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
  if (preview === "empty") return <PageTitle title="קטגוריות" backTo={`/settings${search}`} />;
  return (
    <div className="page">
      <Link to={`/settings${search}`} aria-label="חזרה" className="icon-btn"><BackIcon /></Link>
      <h1 className="t-title-1">קטגוריות</h1>
      <ul className="stack">
        {(categories.data ?? []).map((category) => (
          <li key={category.id} className="project-line">
            <span>{category.name}<span className="t-hint block">{category.kind === "income" ? "הכנסה" : "הוצאה"}{category.hidden ? " · מוסתרת" : ""}</span></span>
            <button
              type="button"
              className="btn-sec"
              onClick={() => {
                if (preview !== "off") return;
                const supabase = getSupabase();
                if (!supabase) return;
                void supabase.rpc("set_category_hidden", { p_id: category.id, p_hidden: !category.hidden }).then(() => invalidate());
              }}
            >
              {category.hidden ? "הצגה" : "הסתרה"}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="stack card"
        onSubmit={(event) => {
          event.preventDefault();
          if (preview !== "off") return;
          const supabase = getSupabase();
          if (!supabase) return;
          void supabase.rpc("merge_category", { p_from: mergeFrom, p_into: mergeInto }).then(() => invalidate());
        }}
      >
        <h2 className="t-title-3">מיזוג</h2>
        <label className="field">מקטגוריה
          <select value={mergeFrom} onChange={(event) => { setMergeFrom(event.target.value); }}>
            <option value="">בחירה</option>
            {(categories.data ?? []).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="field">אל
          <select value={mergeInto} onChange={(event) => { setMergeInto(event.target.value); }}>
            <option value="">בחירה</option>
            {(categories.data ?? []).filter((category) => !category.hidden).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-bad">מיזוג והסתרה</button>
      </form>
    </div>
  );
}

export function NotificationsScreen() {
  const search = usePreviewSearch();
  return (
    <div className="page">
      <Link to={`/settings${search}`} aria-label="חזרה" className="icon-btn"><BackIcon /></Link>
      <h1 className="t-title-1">התראות</h1>
      <p className="t-label">שתי הודעות, שעון ישראל. סיכום ביום ראשון ב-08:00, ותזכורת לאישור ב-18:00 רק כשיש תור.</p>
      <p className="t-hint">בשלב הזה ההודעות לא נשלחות. אין שירות בתשלום ואין Push.</p>
    </div>
  );
}

