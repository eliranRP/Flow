import { useEffect, useState } from "react";
import { deliverFile, fetchReportFile, MAX_PERIODS, PDF_COLUMNS, periodCount, periodRange, reportFileArgs, shareChoiceOf, TooManyFiles, type ShareChoice, type ShareColumns } from "../report-share";
import { projectKeyName, type ReportState, type StatementProject } from "../reports";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { SegmentedControl } from "../ui/segmented-control";
import { Sheet } from "../ui/sheet";
import { useToast } from "../ui/toast";
import { Toggle } from "../ui/toggle";

/** FLOW-993: the columns' words, in the sheet's order. */
const COLUMNS: Array<{ value: ShareColumns; label: string; short?: string }> = [
  { value: "total", label: "סה״כ" },
  { value: "project", label: "פרויקט", short: "פר׳" },
  { value: "month", label: "חודש" },
  { value: "quarter", label: "רבעון" },
  { value: "year", label: "שנה" },
];

/**
 * FLOW-162 (board ReportSharePdf; owner 2026-10-29: "PDF + Excel"): which reports go in the file, whether
 * collapsed sections print in full, and PDF or Excel. FLOW-993 (Reports export design, "גיליון הייצוא"): the
 * columns (one total, a project each, or a month, quarter or year each) and the projects, every one or some.
 * The file is built by flow-mcp from the screen's own period and date, then the phone's share sheet sends it
 * (or it downloads).
 */
export function ReportShareSheet({ open, onOpenChange, state, today, projects }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReportState;
  today: string;
  /** The projects the screen lists, for picking some. */
  projects: readonly StatementProject[];
}) {
  const setOpen = useSheetHistory("report-share", open, onOpenChange);
  const toast = useToast();
  const projectId = state.scope.kind === "project" ? state.scope.id : null;
  const [choice, setChoice] = useState<ShareChoice>(() => shareChoiceOf(state.kind, state.scope.kind, projectId));
  const [busy, setBusy] = useState(false);
  // A file the browser would not share yet (no fresh tap): the next tap shares it without making it again.
  const [ready, setReady] = useState<File | null>(null);
  useEffect(() => {
    if (open) setChoice((current) => ({ ...shareChoiceOf(state.kind, state.scope.kind, projectId), format: current.format, expand: current.expand }));
  }, [open, state.kind, state.scope.kind, projectId]);
  useEffect(() => {
    setReady(null);
  }, [open, choice, state]);
  const real = projects.filter((project) => project.project_id != null);
  const byPeriod = choice.columns === "month" || choice.columns === "quarter" || choice.columns === "year";
  const range = byPeriod ? periodRange(state, today, choice) : null;
  const periods = byPeriod && range != null ? periodCount(choice.columns as "month" | "quarter" | "year", range) : 0;
  // Why the file cannot be made yet, or null.
  const blocked = !choice.pnl && !choice.balance
    ? "בחרו לפחות דוח אחד."
    : choice.projectIds != null && choice.projectIds.length === 0
    ? "בחרו לפחות פרויקט אחד."
    : byPeriod && range == null
    ? "עמודות לפי תקופה צריכות טווח תאריכים: בחרו תקופה במסך."
    : periods > MAX_PERIODS
    ? `עד ${String(MAX_PERIODS)} עמודות: בחרו תקופה קצרה יותר או עמודות ארוכות יותר.`
    : null;
  // A PDF fits 13 amount columns across; more go in another block, which reads less well than quarters or Excel.
  const amountColumns = byPeriod ? periods + 1 : choice.columns === "project" ? (choice.projectIds?.length ?? real.length + 1) + 1 : 1;
  const wide = choice.format === "pdf" && amountColumns > PDF_COLUMNS;
  const word = choice.format === "pdf" ? "PDF" : "Excel";
  const share = async () => {
    if (busy || blocked != null) return;
    setBusy(true);
    try {
      const file = ready ?? await fetchReportFile(reportFileArgs(state, today, choice));
      const title = choice.pnl && choice.balance ? "דוחות" : choice.pnl ? "רווח והפסד" : "מאזן";
      // A second refusal on the kept file: the browser will not share it, so it downloads instead.
      const outcome = await deliverFile(file, title, { download: ready != null });
      if (outcome === "blocked") {
        setReady(file);
        return;
      }
      setReady(null);
      if (outcome !== "cancelled") setOpen(false);
      if (outcome === "saved") toast.show({ message: `הקובץ ${file.name} ירד`, tone: "ok" });
    } catch (error) {
      toast.show({ message: error instanceof TooManyFiles ? "נוצרו הרבה קבצים בדקה האחרונה. נסו שוב בעוד דקה." : "הקובץ לא נוצר. נסו שוב.", tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  const pickProject = (id: string, on: boolean) => {
    const current = choice.projectIds ?? [];
    setChoice({ ...choice, projectIds: on ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id) });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={`שיתוף ${word}`}
      panelClassName="ui-rep-sheet"
      action={(
        <Button full disabled={blocked != null} busy={busy} onClick={() => { void share(); }}>
          {ready != null ? "שליחת הקובץ" : `שיתוף ${word}`}
        </Button>
      )}
    >
      <div className="ui-rep-share">
        <SegmentedControl<"pdf" | "xlsx">
          label="סוג הקובץ"
          showLabel={false}
          radius="input"
          value={choice.format}
          onChange={(format) => { setChoice({ ...choice, format }); }}
          options={[{ value: "pdf", label: "PDF" }, { value: "xlsx", label: "Excel" }]}
        />
        <Toggle label="רווח והפסד" checked={choice.pnl} onChange={(pnl) => { setChoice({ ...choice, pnl }); }} />
        <Toggle label="מאזן" checked={choice.balance} onChange={(balance) => { setChoice({ ...choice, balance }); }} />
        <SegmentedControl<ShareColumns>
          label="עמודות לפי"
          radius="input"
          value={choice.columns}
          onChange={(columns) => { setChoice({ ...choice, columns }); }}
          options={COLUMNS}
        />
        <Toggle label="לפרט קטעים מכווצים" hint="כל תת־קטגוריה מתחת לקטגוריה שלה" checked={choice.expand} disabled={!choice.pnl} onChange={(expand) => { setChoice({ ...choice, expand }); }} />
        {real.length > 0 ? (
          <Toggle
            label="כל הפרויקטים"
            hint={choice.columns === "project" ? "עמודה לכל פרויקט ועמודת כללי" : "כל הפרויקטים יחד"}
            checked={choice.projectIds == null}
            onChange={(all) => { setChoice({ ...choice, projectIds: all ? null : [] }); }}
          />
        ) : null}
        {choice.projectIds != null ? (
          <div className="ui-rep-share-projects" role="group" aria-label="פרויקטים">
            {real.map((project) => {
              const id = project.project_id ?? "";
              return <Toggle key={id} label={projectKeyName(project)} checked={choice.projectIds?.includes(id) ?? false} onChange={(on) => { pickProject(id, on); }} />;
            })}
          </div>
        ) : null}
        <p className="t-caption t-muted">
          {blocked ?? (ready != null
            ? "הקובץ מוכן. הקישו על שליחת הקובץ."
            : wide
            ? `${String(amountColumns)} עמודות לא נכנסות ברוחב הדף ויתחלקו לכמה טבלאות. לפי רבעון או ב־Excel ייראה טוב יותר.`
            : choice.format === "pdf"
            ? "קובץ PDF בעברית, עמוד לכל דוח, עם התאריכים שעל המסך."
            : "קובץ Excel עם גיליון לכל דוח, נוסחאות לסיכומים ואותם המספרים שעל המסך.")}
        </p>
      </div>
    </Sheet>
  );
}
