import { useEffect, useState } from "react";
import { deliverFile, fetchReportFile, reportFileArgs, type ShareChoice } from "../report-share";
import type { ReportState } from "../reports";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { SegmentedControl } from "../ui/segmented-control";
import { Sheet } from "../ui/sheet";
import { useToast } from "../ui/toast";
import { Toggle } from "../ui/toggle";

/**
 * FLOW-162 (board ReportSharePdf; owner 2026-10-29: "PDF + Excel"): which reports go in the file, whether
 * collapsed sections print in full, and PDF or Excel. The file is built by flow-mcp from the screen's own
 * period, date and projects, then the phone's share sheet sends it (or it downloads).
 */
export function ReportShareSheet({ open, onOpenChange, state, today }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ReportState;
  today: string;
}) {
  const setOpen = useSheetHistory("report-share", open, onOpenChange);
  const toast = useToast();
  const [choice, setChoice] = useState<ShareChoice>({ pnl: true, balance: false, expand: true, format: "pdf" });
  const [busy, setBusy] = useState(false);
  // A file the browser would not share yet (no fresh tap): the next tap shares it without making it again.
  const [ready, setReady] = useState<File | null>(null);
  useEffect(() => {
    if (open) setChoice((current) => ({ ...current, pnl: state.kind === "pnl", balance: state.kind === "balance" }));
  }, [open, state.kind]);
  useEffect(() => {
    setReady(null);
  }, [open, choice, state]);
  const byProject = state.scope.kind === "by_project";
  const none = !choice.pnl && !choice.balance;
  const word = choice.format === "pdf" ? "PDF" : "Excel";
  const share = async () => {
    if (busy || none) return;
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
    } catch {
      toast.show({ message: "הקובץ לא נוצר. נסו שוב.", tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={`שיתוף ${word}`}
      panelClassName="ui-rep-sheet"
      action={(
        <Button full disabled={none} busy={busy} onClick={() => { void share(); }}>
          {ready != null ? "שליחת הקובץ" : `שיתוף ${word}`}
        </Button>
      )}
    >
      <div className="ui-rep-share">
        <SegmentedControl<"pdf" | "csv">
          label="סוג הקובץ"
          showLabel={false}
          radius="input"
          value={choice.format}
          onChange={(format) => { setChoice({ ...choice, format }); }}
          options={[{ value: "pdf", label: "PDF" }, { value: "csv", label: "Excel" }]}
        />
        <Toggle label="רווח והפסד" checked={choice.pnl} onChange={(pnl) => { setChoice({ ...choice, pnl }); }} />
        <Toggle label="מאזן" checked={choice.balance} onChange={(balance) => { setChoice({ ...choice, balance }); }} />
        <Toggle label="לפרט קטעים מכווצים" hint="כל תת־קטגוריה מתחת לקטגוריה שלה" checked={choice.expand && !byProject} disabled={!choice.pnl || byProject} onChange={(expand) => { setChoice({ ...choice, expand }); }} />
        <p className="t-caption t-muted">
          {none ? "בחרו לפחות דוח אחד." : ready != null ? "הקובץ מוכן. הקישו על שליחת הקובץ." : choice.format === "pdf" ? "קובץ PDF בעברית, עמוד לכל דוח, עם התאריכים והפרויקטים שעל המסך." : "קובץ CSV שנפתח ב־Excel, עם אותם המספרים שעל המסך."}
        </p>
      </div>
    </Sheet>
  );
}
