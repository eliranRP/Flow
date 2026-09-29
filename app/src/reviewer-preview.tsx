import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { formatIls } from "@flow/shared";
import { FiledTodayScreen, ReviewQueue, SplitScreen } from "./screens/flow-screens";
import {
  reviewerBooks,
  reviewerCategories,
  reviewerFiled,
  reviewerProjectChoices,
  reviewerQueue,
  reviewerSharedAgorot,
  reviewerSplitProjects,
  reviewerWaitingPaintAgorot,
  sampleSaveMode,
  type SampleSave,
} from "./reviewer-sample";
import { useWrite } from "./use-write";
import { Button } from "./ui/button";
import { ChangeAssignment, changeSaveFailure } from "./ui/change-sheet";
import { ScreenHeader } from "./ui/screen-header";
import { useToast } from "./ui/toast";

/**
 * Dev-server preview for a design or PR review.
 * Imported only from the `import.meta.env.DEV` route. The hosted build drops this module.
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
  else if (path.endsWith("/save")) page = <ReviewerSave />;
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
    { label: "חומרים", amount: books.materials },
    { label: "הובלה", amount: books.haul },
    { label: "אושרו", amount: books.approved },
    { label: "ממתינות לאישור", amount: books.waiting },
    { label: "הוצאות הפרויקט", amount: books.projectExpenses },
    { label: "רווח", amount: books.profit },
    { label: "עלות משותפת בתור", amount: books.shared },
  ];
  const herzl = books.split.find((part) => part.id === "p-herzl");
  const raanana = books.split.find((part) => part.id === "p-raanana");
  return (
    <>
      <ScreenHeader
        title="תצוגת ביקורת"
        subtitle="תור, שיוך מהיום, ושמירה שאפשר להצליח או להכשיל"
      />
      <section className="ui-page-pad">
        <h2 className="t-title-3">שיפוץ הרצל 12</h2>
        {lines.map((line) => (
          <p className="ui-review-line" key={line.label}>
            <span className="t-label">{line.label}</span>
            <bdi className="ui-num" dir="ltr">{money(line.amount)}</bdi>
          </p>
        ))}
        <p className="t-hint">
          אושרו הם חומרים ועוד הובלה. הוצאות הפרויקט הן אושרו ועוד ממתינות לאישור. הרווח הוא ההכנסות פחות הוצאות הפרויקט.
          {" "}
          <bdi className="ui-num" dir="ltr">{String(books.filedCount)}</bdi>
          {" תנועות שויכו היום, וזה מספר השורות ברשימה."}
        </p>
        <p className="t-hint">
          חלוקה לפי הכנסות של העלות המשותפת:
          {" "}
          <bdi className="ui-num" dir="ltr">{herzl ? money(herzl.agorot) : ""}</bdi>
          {" ו־"}
          <bdi className="ui-num" dir="ltr">{raanana ? money(raanana.agorot) : ""}</bdi>
          {". וילה רעננה נכנסת רק במשקל החלוקה, "}
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
        <Button full variant="secondary" to="/reviewer/save?save=ok">שמירה שמצליחה</Button>
        <Button full variant="secondary" to="/reviewer/save?save=fail">שמירה שנדחית</Button>
        <Button full variant="secondary" to="/reviewer/save?save=offline">שמירה בלי חיבור</Button>
      </div>
    </>
  );
}

function ReviewerQueue() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const mode = sampleSaveMode(params.get("save"));
  const [rows, setRows] = useState(reviewerQueue);
  const search = `?save=${mode}`;
  return (
    <ReviewQueue
      rows={rows}
      search={search}
      sample
      sampleSave={mode}
      changeTo={`/reviewer/save?save=${mode}`}
      filedTo="/reviewer/filed"
      backTo="/reviewer"
      homeTo="/reviewer"
      homeLabel="לתצוגת הביקורת"
      onShared={() => {
        void navigate(`/reviewer/split${search}`);
      }}
      onSampleDone={(id) => {
        setRows((current) => current.filter((row) => row.id !== id));
      }}
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
  const mode = sampleSaveMode(params.get("save"));
  const navigate = useNavigate();
  const toast = useToast();
  const [projectId, setProjectId] = useState("p-herzl");
  const [categoryId, setCategoryId] = useState("c-materials");
  const [remember, setRemember] = useState(true);
  const [projects, setProjects] = useState(reviewerProjectChoices);
  const write = useSampleWrite(mode, "השיוך נשמר", () => {
    void navigate("/reviewer/review");
  });
  return (
    <ChangeAssignment
      host="route"
      closeTo="/reviewer"
      supplier="צבעי הגליל בע״מ"
      amount={money(reviewerWaitingPaintAgorot)}
      direction="expense"
      projects={projects}
      categories={reviewerCategories}
      projectId={projectId}
      categoryId={categoryId}
      suggestionProjectId="p-herzl"
      suggestionCategoryId="c-materials"
      onProjectId={setProjectId}
      onCategoryId={setCategoryId}
      remember={remember}
      onRemember={setRemember}
      saving={write.isPending}
      onSave={() => {
        if (projectId === "" || categoryId === "") {
          toast.show({ tone: "bad", message: "בחרו פרויקט וקטגוריה." });
          return;
        }
        write.mutate();
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

function ReviewerSplit() {
  const [params] = useSearchParams();
  const mode = sampleSaveMode(params.get("save"));
  const write = useSampleWrite(mode, "החלוקה נשמרה");
  return (
    <SplitScreen
      sampleAmount={reviewerSharedAgorot}
      sampleProjects={reviewerSplitProjects}
      sampleMeta="מנופי המרכז בע״מ · 29/09/2026"
      backTo={`/reviewer/review?save=${mode}`}
      onSave={() => {
        write.mutate();
      }}
    />
  );
}

function useSampleWrite(mode: SampleSave, success: string, onSuccess?: () => void) {
  return useWrite({
    failure: changeSaveFailure,
    success,
    keys: [],
    onSuccess,
    run: () => {
      if (mode === "fail") return Promise.reject(new Error("category kind must match the direction"));
      if (mode === "offline") return Promise.reject(new Error("Failed to fetch"));
      return Promise.resolve();
    },
  });
}
