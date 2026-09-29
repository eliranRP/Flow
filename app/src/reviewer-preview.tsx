import { useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { formatIls, type ProjectWaitingRow, type ReviewRow } from "@flow/shared";
import { FiledTodayScreen, ProjectCategoryScreen, ProjectWaitingList, ReviewEmpty, ReviewQueue, SplitScreen, TransactionScreen, reviewIsSplit, reviewSplitTitle } from "./screens/flow-screens";
import {
  patchReviewerCategory,
  reviewerBooks,
  reviewerCategories,
  reviewerFiled,
  reviewerOtherProjectName,
  reviewerProjectChoices,
  reviewerProjectName,
  reviewerQueueView,
  reviewerSharedAgorot,
  reviewerSplitProjects,
  reviewerWaitingPaintAgorot,
  sampleSaveMode,
  subscribeReviewerQueue,
  type SampleSave,
} from "./reviewer-sample";
import { useWrite } from "./use-write";
import { Button } from "./ui/button";
import { ChangeAssignment, changeSaveFailure } from "./ui/change-sheet";
import { FigureLine, SectionHead, SharedCostNote } from "./ui/layout";
import { ScreenHeader } from "./ui/screen-header";
import { useToast } from "./ui/toast";

/**
 * Dev-server preview for a design or PR review.
 * Imported from the dev server, or from a build with VITE_REVIEWER_BUILD=1.
 * The hosted build leaves that unset and drops this module.
 * Every screen carries the sample mark. Nothing here is written to a ledger.
 */
const exampleMark = "נתוני דוגמה · Example data";

export function ReviewerPreview() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/$/, "") || "/";
  let page = <ReviewerHome />;
  if (path.includes("/transaction/")) page = <ReviewerTransaction path={path} />;
  else if (path.endsWith("/review")) page = <ReviewerQueue />;
  else if (path.endsWith("/filed")) page = <ReviewerFiled />;
  else if (path.endsWith("/category")) page = <ReviewerCategory />;
  else if (path.endsWith("/waiting")) page = <ReviewerWaiting />;
  else if (path.endsWith("/project")) page = <ReviewerProject />;
  else if (path.endsWith("/save")) page = <ReviewerSave />;
  else if (path.endsWith("/split-expense")) page = <ReviewerSplitExpense />;
  else if (path.endsWith("/unsplit")) page = <ReviewerUnsplit />;
  else if (path.endsWith("/split")) page = <ReviewerSplit />;
  return (
    <>
      <p className="ui-example-bar t-hint">{exampleMark}</p>
      {page}
    </>
  );
}

function money(agorot: bigint): string {
  return formatIls(agorot);
}

function ReviewerHome() {
  const books = reviewerBooks();
  const lines = [
    { label: "הכנסות", amount: books.income },
    { label: "מלט", amount: books.materials },
    { label: "שינוע", amount: books.haul },
    { label: "אושרו", amount: books.approved },
    { label: "ממתינות לאישור", amount: books.waiting },
    { label: "הוצאות הפרויקט", amount: books.projectExpenses },
    { label: "רווח", amount: books.profit },
    { label: "עלות משותפת בתור", amount: books.shared },
  ];
  const alon = books.split.find((part) => part.id === "p-alon");
  const raanana = books.split.find((part) => part.id === "p-raanana");
  return (
    <>
      <ScreenHeader
        title="תצוגת ביקורת"
        subtitle="תור, שיוך מהיום, ושמירה שאפשר להצליח או להכשיל"
      />
      <section className="ui-page-pad">
        <h2 className="t-title-3">{reviewerProjectName}</h2>
        {lines.map((line) => (
          <p className="ui-review-line" key={line.label}>
            <span className="t-label">{line.label}</span>
            <bdi className="ui-num" dir="ltr">{money(line.amount)}</bdi>
          </p>
        ))}
        <p className="t-hint">
          אושרו הם מלט ועוד שינוע. הוצאות הפרויקט הן אושרו ועוד ממתינות לאישור. הרווח הוא ההכנסות פחות הוצאות הפרויקט.
          {" "}
          <bdi className="ui-num" dir="ltr">{String(books.filedCount)}</bdi>
          {" תנועות שויכו היום, וזה מספר השורות ברשימה."}
        </p>
        <p className="t-hint">
          חלוקה לפי הכנסות של העלות המשותפת:
          {" "}
          <bdi className="ui-num" dir="ltr">{alon ? money(alon.agorot) : ""}</bdi>
          {" ו־"}
          <bdi className="ui-num" dir="ltr">{raanana ? money(raanana.agorot) : ""}</bdi>
          {`. ${reviewerOtherProjectName} נכנס רק במשקל החלוקה, `}
          <bdi className="ui-num" dir="ltr">{money(books.otherIncome)}</bdi>
          .
        </p>
      </section>
      <div className="ui-stack ui-page-pad">
        <Button full to="/reviewer/review">תור לאישור</Button>
        <Button full variant="secondary" to="/reviewer/review?save=fail">תור, שמירה שנדחית</Button>
        <Button full variant="secondary" to="/reviewer/review?save=offline">תור, בלי חיבור</Button>
        <Button full variant="secondary" to="/reviewer/filed">שויכו היום</Button>
        <Button full variant="secondary" to="/reviewer/filed?empty=1">שויכו היום, אין תנועות</Button>
        <Button full variant="secondary" to="/reviewer/category">קטגוריה, מלט</Button>
        <Button full variant="secondary" to="/reviewer/category?empty=1">קטגוריה, אין תנועות</Button>
        <Button full variant="secondary" to="/reviewer/category?more=1">קטגוריה, עוד תנועות</Button>
        <Button full variant="secondary" to="/reviewer/waiting">לאישור בפרויקט</Button>
        <Button full variant="secondary" to="/reviewer/project">תור של הפרויקט</Button>
        <Button full variant="secondary" to="/reviewer/project?empty=1">תור של הפרויקט, אין פריטים</Button>
        <Button full variant="secondary" to="/reviewer/save?save=ok">שמירה שמצליחה</Button>
        <Button full variant="secondary" to="/reviewer/save?save=fail">שמירה שנדחית</Button>
        <Button full variant="secondary" to="/reviewer/save?save=offline">שמירה בלי חיבור</Button>
        <Button full variant="secondary" to="/reviewer/save?save=shared">שמירה, עלות משותפת</Button>
        <Button full variant="secondary" to="/reviewer/split-expense">הוצאה מפוצלת, שינוי קטגוריה</Button>
        <Button full variant="secondary" to="/reviewer/unsplit">חלוקה חזרה לפרויקט אחד</Button>
      </div>
    </>
  );
}

function ReviewerQueue() {
  const [params] = useSearchParams();
  const rows = useSyncExternalStore(subscribeReviewerQueue, reviewerQueueView, reviewerQueueView);
  const mode = sampleSaveMode(params.get("save"));
  const search = `?save=${mode}`;
  return (
    <SampleQueue
      rows={rows}
      mode={mode}
      search={search}
      changeTo={`/reviewer/save?save=${mode}`}
      filedTo="/reviewer/filed"
      backTo="/reviewer"
      homeTo="/reviewer"
      homeLabel="לתצוגת הביקורת"
    />
  );
}

function ReviewerFiled() {
  const [params] = useSearchParams();
  const empty = params.get("empty") === "1";
  return (
    <FiledTodayScreen
      sample={empty ? [] : reviewerFiled}
      backTo="/reviewer"
      rowHref={(row) => `/reviewer/transaction/${row.id}`}
    />
  );
}

function ReviewerCategory() {
  const [params] = useSearchParams();
  const empty = params.get("empty") === "1";
  const more = params.get("more") === "1";
  const materials = reviewerFiled.filter((row) => row.category_name === "מלט");
  const rows = empty ? [] : materials.map((row) => ({
    id: row.id,
    description: row.description,
    doc_date: row.doc_date,
    amount_net: row.amount_net,
  }));
  return (
    <ProjectCategoryScreen
      backTo="/reviewer"
      rowHref={(row) => `/reviewer/transaction/${row.id}`}
      sample={{
        categoryName: "מלט",
        projectName: reviewerProjectName,
        pageSize: more ? 1 : undefined,
        rows,
      }}
    />
  );
}

function ReviewerWaiting() {
  const queue = useSyncExternalStore(subscribeReviewerQueue, reviewerQueueView, reviewerQueueView);
  const rows: ProjectWaitingRow[] = queue
    .filter((row) => row.project_id != null && row.transaction_id != null)
    .map((row) => ({
      review_id: row.id,
      transaction_id: row.transaction_id ?? row.id,
      description: row.description,
      doc_date: row.doc_date,
      amount_net: row.amount_net,
      direction: row.direction,
      reason: row.reason,
      project_id: row.project_id,
      category_id: row.category_id,
      category_name: row.category_name ?? null,
      supplier_name: row.supplier_name,
    }));
  return (
    <ProjectWaitingList
      rows={rows}
      search=""
      backTo="/reviewer"
      hrefFor={(row) => row.review_id == null
        ? `/reviewer/transaction/${row.transaction_id}`
        : `/reviewer/save?save=ok&item=${row.review_id}`}
    />
  );
}

function ReviewerProject() {
  const [params] = useSearchParams();
  const queue = useSyncExternalStore(subscribeReviewerQueue, reviewerQueueView, reviewerQueueView);
  if (params.get("empty") === "1") {
    return <ReviewEmpty search="" filtered backTo="/reviewer" homeTo="/reviewer" homeLabel="חזרה לפרויקט" />;
  }
  return (
    <SampleQueue
      rows={queue.filter((row) => row.project_id != null)}
      mode="ok"
      search=""
      changeTo="/reviewer/save?save=ok"
      filedTo="/reviewer/filed"
      backTo="/reviewer"
      homeTo="/reviewer"
      homeLabel="חזרה לפרויקט"
    />
  );
}

function ReviewerTransaction({ path }: { path: string }) {
  const id = path.split("/").pop() ?? "";
  const row = reviewerFiled.find((item) => item.id === id);
  if (!row) {
    return <ScreenHeader title="תנועה" subtitle="השורה לא ברשימת הדוגמה" backTo="/reviewer/filed" />;
  }
  return (
    <>
      <ScreenHeader title="הוצאה" subtitle={row.supplier_name ?? row.description} backTo="/reviewer/filed" />
      <p className="ui-page-pad t-display">
        <bdi className="ui-num" dir="ltr">{money(-row.amount_net)}</bdi>
      </p>
      <p className="ui-page-pad t-body">
        {row.project_name} · {row.category_name}
      </p>
    </>
  );
}

function ReviewerSave() {
  const [params] = useSearchParams();
  const queue = useSyncExternalStore(subscribeReviewerQueue, reviewerQueueView, reviewerQueueView);
  const mode = sampleSaveMode(params.get("save"));
  const item = queue.find((row) => row.id === params.get("item")) ?? queue.find((row) => row.supplier_name === "צבעי הכרמל בע״מ");
  const split = reviewIsSplit(item);
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState(split ? "" : (item?.project_id ?? "p-alon"));
  const [categoryId, setCategoryId] = useState(item?.category_id ?? "");
  const [remember, setRemember] = useState(true);
  const [hold, setHold] = useState("");
  const [projects, setProjects] = useState(reviewerProjectChoices);
  const write = useSampleWrite(mode, "השיוך נשמר", () => {
    if (!split) void navigate("/reviewer/review", { replace: true });
  }, () => {
    void navigate(`/reviewer/split?save=${mode}`);
  });
  const amount = item?.amount_net == null ? reviewerWaitingPaintAgorot : (item.amount_net < 0n ? -item.amount_net : item.amount_net);
  const baselineProject = split ? "" : (item?.project_id ?? "p-alon");
  const baselineCategory = item?.category_id ?? "";
  return (
    <ChangeAssignment
      host="route"
      closeTo="/reviewer"
      supplier={item?.supplier_name ?? "צבעי הכרמל בע״מ"}
      amount={money(amount)}
      direction="expense"
      projects={projects}
      categories={reviewerCategories}
      projectId={projectId}
      categoryId={categoryId}
      suggestionProjectId={split ? "" : (item?.project_id ?? "p-alon")}
      suggestionCategoryId={item?.category_id ?? ""}
      projectTitle={split && item ? reviewSplitTitle(item) : undefined}
      projectNote={split ? "החלוקה תרד, והסכום כולו יעבור לפרויקט הזה." : undefined}
      onProjectId={setProjectId}
      onCategoryId={setCategoryId}
      remember={remember}
      onRemember={setRemember}
      pending={remember !== true}
      hold={hold}
      onDiscard={() => {
        setProjectId(baselineProject);
        setCategoryId(baselineCategory);
        setHold("");
      }}
      onCommitPick={async (kind, id) => {
        const previousProject = projectId;
        const previousCategory = categoryId;
        if (kind === "project") setProjectId(id);
        else setCategoryId(id);
        try {
          await write.mutateAsync();
        } catch (error) {
          setProjectId(previousProject);
          setCategoryId(previousCategory);
          throw error;
        }
        if (split && kind === "category" && item) {
          const name = reviewerCategories.find((category) => category.id === id)?.name ?? "";
          patchReviewerCategory(item.id, id, name);
          setHold("");
          return;
        }
        if (split) return;
        return "left";
      }}
      onCommitPending={async () => {
        const complete = split ? categoryId !== "" : projectId !== "" && categoryId !== "";
        if (!complete) {
          setHold(split ? "בחרו קטגוריה." : "בחרו פרויקט וקטגוריה.");
          throw new Error("incomplete");
        }
        if (remember !== true) {
          setHold("הזכירה נשמרת עם השיוך. החזירו את המתג כדי לסגור.");
          throw new Error("remember");
        }
      }}
      onSplit={() => {
        void navigate(`/reviewer/split?save=${mode}`);
      }}
      onCreateProject={(name) => {
        const created = { id: `p-extra-${String(projects.length)}`, name, status: "active" as const };
        setProjects((list) => [...list, created]);
        toast.show({ message: "הפרויקט נשמר" });
        return Promise.resolve(created);
      }}
    />
  );
}

const unsplitProjects = [
  { id: "p-alon", name: reviewerProjectName, bp: 1667 },
  { id: "p-raanana", name: reviewerOtherProjectName, bp: 1667 },
  { id: "p-north", name: "מגרש הצפון", bp: 1667 },
  { id: "p-south", name: "מחסן הדרום", bp: 1667 },
  { id: "p-east", name: "גג המזרח", bp: 1666 },
  { id: "p-west", name: "חניון המערב", bp: 1666 },
] as const;

const unsplitNet = 320_000n;

function unsplitShare(bp: number): bigint {
  return (unsplitNet * BigInt(bp)) / 10_000n;
}

function ReviewerUnsplit() {
  const toast = useToast();
  const [collapsed, setCollapsed] = useState<string | null>(null);
  const [showSplit, setShowSplit] = useState(true);
  const projects = unsplitProjects.map((project) => ({ id: project.id, name: project.name }));
  const spent = (id: string, bp: number) => collapsed == null
    ? unsplitShare(bp)
    : collapsed === id
      ? unsplitNet
      : 0n;
  return (
    <>
      <div className="ui-page-pad">
        <Button
          variant="secondary"
          onClick={() => { setShowSplit((open) => !open); }}
        >
          {showSplit ? "שינוי שיוך" : "איך לחלק?"}
        </Button>
      </div>
      <section aria-label="סכומי הפרויקטים">
        <SectionHead title="סכומי הפרויקטים" />
        {unsplitProjects.map((project) => {
          const amount = spent(project.id, project.bp);
          const shared = collapsed == null;
          return (
            <article key={project.id} aria-label={project.name}>
              <h3 className="t-title-3 ui-page-pad">{project.name}</h3>
              <FigureLine label="הוצאות" value={formatIls(amount, { agorot: true })} />
              {shared ? <SharedCostNote /> : null}
            </article>
          );
        })}
      </section>
      {showSplit ? (
        <SplitScreen
          sampleAmount={unsplitNet}
          sampleProjects={projects}
          sampleMeta="ליסינג הדרך בע״מ · 01/07/2026"
          backTo="/reviewer"
          onOneProject={async (id): Promise<"left"> => {
            setCollapsed(id);
            setShowSplit(false);
            toast.show({
              message: "השיוך נשמר",
              action: "ביטול",
              onAction: () => { setCollapsed(null); },
            });
            return "left";
          }}
        />
      ) : (
        <TransactionScreen
          sample={{
            id: "t-leasing",
            description: "ליסינג",
            direction: "expense",
            doc_date: "2026-07-01",
            amount_gross: -377_600n,
            amount_net: -unsplitNet,
            vat_amount: -57_600n,
            vat_status: "source",
            source: "sumit",
            pnl_role: collapsed == null ? "shared" : "project",
            review_status: "approved",
            project_id: collapsed,
            project_name: collapsed == null ? null : projects.find((project) => project.id === collapsed)?.name ?? null,
            category_id: "c-materials",
            category_name: "מלט",
            supplier_name: "ליסינג הדרך בע״מ",
            customer_name: null,
            allocations: collapsed == null
              ? unsplitProjects.map((project) => ({
                project_id: project.id,
                project_name: project.name,
                share_bp: project.bp,
                amount_net: -unsplitShare(project.bp),
              }))
              : [{
                project_id: collapsed,
                project_name: projects.find((project) => project.id === collapsed)?.name ?? "",
                share_bp: 10000,
                amount_net: -unsplitNet,
              }],
          }}
          sampleProjects={projects}
          sampleCategories={reviewerCategories}
          onOpenSplit={() => { setShowSplit(true); }}
          onSampleUnsplit={(id) => { setCollapsed(id); }}
          onSampleUndo={() => { setCollapsed(null); }}
        />
      )}
    </>
  );
}

function ReviewerSplitExpense() {
  const projects = [
    { id: "p-alon", name: reviewerProjectName },
    { id: "p-raanana", name: reviewerOtherProjectName },
    { id: "p-north", name: "מגרש הצפון" },
    { id: "p-south", name: "מחסן הדרום" },
    { id: "p-east", name: "גג המזרח" },
    { id: "p-west", name: "חניון המערב" },
  ];
  const net = -320_000n;
  const shares = [1667, 1667, 1667, 1667, 1666, 1666];
  return (
    <TransactionScreen
      sample={{
        id: "t-leasing",
        description: "ליסינג",
        direction: "expense",
        doc_date: "2026-07-01",
        amount_gross: -377_600n,
        amount_net: net,
        vat_amount: -57_600n,
        vat_status: "source",
        source: "sumit",
        pnl_role: "shared",
        review_status: "approved",
        project_id: null,
        project_name: null,
        category_id: "c-materials",
        category_name: "מלט",
        supplier_name: "ליסינג הדרך בע״מ",
        customer_name: null,
        allocations: projects.map((project, index) => ({
          project_id: project.id,
          project_name: project.name,
          share_bp: shares[index] ?? 0,
          amount_net: (net * BigInt(shares[index] ?? 0)) / 10_000n,
        })),
      }}
      sampleProjects={projects}
      sampleCategories={reviewerCategories}
    />
  );
}

function ReviewerSplit() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mode = sampleSaveMode(params.get("save"));
  const write = useSampleWrite(mode, "החלוקה נשמרה", () => {
    void navigate(`/reviewer/review?save=${mode}`);
  });
  return (
    <SplitScreen
      sampleAmount={reviewerSharedAgorot}
      sampleProjects={reviewerSplitProjects}
      sampleMeta="עגורני החוף בע״מ · 29/09/2026"
      backTo={`/reviewer/review?save=${mode}`}
      onSave={async () => {
        try {
          await write.mutateAsync();
        } catch {
          // useWrite already toasted. Returning false keeps that toast and the screen.
          return false;
        }
      }}
    />
  );
}

function useSampleWrite(mode: SampleSave, success: string, onSuccess?: () => void, onSplit?: () => void) {
  return useWrite({
    failure: changeSaveFailure,
    success,
    keys: [],
    onSuccess,
    onSplit,
    run: () => sampleRun(mode),
  });
}

function sampleRun(mode: SampleSave): Promise<void> {
  if (mode === "fail") return Promise.reject(new Error("category kind must match the direction"));
  if (mode === "offline") return Promise.reject(new Error("Failed to fetch"));
  if (mode === "shared") return Promise.reject(new Error("shared costs are split"));
  return Promise.resolve();
}

function SampleQueue({
  rows: initial,
  mode,
  search,
  changeTo,
  filedTo,
  backTo,
  homeTo,
  homeLabel,
}: {
  rows: ReviewRow[];
  mode: SampleSave;
  search: string;
  changeTo: string;
  filedTo: string;
  backTo: string;
  homeTo: string;
  homeLabel: string;
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(initial);
  return (
    <ReviewQueue
      rows={rows}
      search={search}
      sample
      previewWrite={{
        run: () => sampleRun(mode),
        onDone: (id) => {
          setRows((current) => current.filter((row) => row.id !== id));
        },
        onUndo: (id) => {
          const original = initial.find((row) => row.id === id);
          if (!original) return;
          setRows((current) => (current.some((row) => row.id === id) ? current : [original, ...current]));
        },
      }}
      changeTo={changeTo}
      filedTo={filedTo}
      backTo={backTo}
      homeTo={homeTo}
      homeLabel={homeLabel}
      onShared={() => {
        void navigate(`/reviewer/split${search === "" ? "" : search}`);
      }}
    />
  );
}
