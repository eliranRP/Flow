// FLOW-957 (board "C · Sheet — approval card"): the approval card's row for notes and files, and the
// "לפני שמאשרים" sheet it opens: Mercury's note, a photo, a file or a note, then "לשמור ולאשר".
import { useId, useRef, useState } from "react";
import {
  THREAD_COUNTS_KEY,
  THREAD_FILE_TYPES,
  THREAD_KEY,
  THREAD_NOTE_MAX,
  threadCount,
  useThreadCounts,
  useThreadQuery,
} from "../transaction-thread";
import { Button } from "../ui/button";
import { CameraIcon, CheckIcon, DocumentIcon, NoteIcon, PaperclipIcon } from "../ui/icons";
import { Sheet } from "../ui/sheet";
import { useWrite } from "../use-write";
import { DraftFiles, MercuryNoteCard, saveThreadDraft, usePickFiles, type ThreadDraft } from "./transaction-thread";
import "../ui/css/58-transaction-thread.css";

/** The row's words: what the line holds, or the way in when it holds nothing. */
export function reviewThreadLabel(notes: number, files: number): string {
  if (notes === 0 && files === 0) return "הוספת הערה או קובץ";
  const parts = [
    notes === 1 ? "הערה" : notes > 1 ? `${String(notes)} הערות` : null,
    files === 1 ? "קובץ" : files > 1 ? `${String(files)} קבצים` : null,
  ].filter(Boolean);
  return `הערות וקבצים · ${parts.join(" · ")}`;
}

export function BeforeApproveSheet({
  open,
  onOpenChange,
  transactionId,
  approveDisabled,
  onApprove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionId: string;
  approveDisabled: boolean;
  onApprove: () => void;
}) {
  const thread = useThreadQuery(transactionId, open);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const pick = usePickFiles(setFiles);
  const empty = text.trim() === "" && files.length === 0;
  const save = useWrite<ThreadDraft & { approve: boolean }>({
    keys: [THREAD_KEY, THREAD_COUNTS_KEY],
    run: async (draft) => {
      const companyId = thread.data?.company_id;
      if (!companyId) throw new Error("thread");
      await saveThreadDraft(companyId, transactionId, draft);
    },
    failure: "ההערה לא נשמרה",
    onSuccess: ({ approve }) => {
      setText("");
      setFiles([]);
      onOpenChange(false);
      if (approve) onApprove();
    },
  });
  const mercuryNote = thread.data?.notes.find((note) => note.source === "mercury") ?? null;
  const mercuryFiles = thread.data?.files.filter((file) => file.source === "mercury") ?? [];
  const ownCount = (thread.data?.notes.filter((note) => note.source === "flow").length ?? 0)
    + (thread.data?.files.filter((file) => file.source === "flow").length ?? 0);
  const onPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    pick(event.target.files);
    event.target.value = "";
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="לפני שמאשרים" busy={save.isPending}>
      <div className="ui-before-approve">
        {mercuryNote != null || mercuryFiles.length > 0 ? (
          <MercuryNoteCard note={mercuryNote} files={mercuryFiles} holdWrites={false} compact />
        ) : null}
        {ownCount > 0 ? <p className="t-caption t-muted">{`עוד ${String(ownCount)} בדף התנועה`}</p> : null}
        <div className="ui-before-approve-picks">
          <button type="button" className="ui-before-approve-pick m-press" onClick={() => { camera.current?.click(); }}>
            <CameraIcon size={22} />
            צילום
          </button>
          <button type="button" className="ui-before-approve-pick m-press" onClick={() => { picker.current?.click(); }}>
            <DocumentIcon size={22} />
            קובץ
          </button>
          <button type="button" className="ui-before-approve-pick m-press" onClick={() => { field.current?.focus(); }}>
            <NoteIcon size={22} />
            הערה
          </button>
        </div>
        <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={onPicked} />
        <input ref={picker} type="file" hidden multiple accept={THREAD_FILE_TYPES.join(",")} onChange={onPicked} />
        <label htmlFor={fieldId} className="sr-only">הערה</label>
        <textarea
          ref={field}
          id={fieldId}
          dir="auto"
          rows={2}
          className="ui-thread-field"
          placeholder="מה חשוב לזכור על התנועה הזו?"
          maxLength={THREAD_NOTE_MAX}
          value={text}
          onChange={(event) => { setText(event.target.value); }}
        />
        <DraftFiles files={files} onRemove={(index) => { setFiles((list) => list.filter((_, at) => at !== index)); }} />
        <Button
          full
          icon={<CheckIcon />}
          busy={save.isPending}
          disabled={approveDisabled || thread.data == null}
          onClick={() => {
            if (empty) {
              onOpenChange(false);
              onApprove();
              return;
            }
            save.mutate({ text, files, approve: true });
          }}
        >
          {empty ? "לאשר" : "לשמור ולאשר"}
        </Button>
        {empty ? null : (
          <Button variant="link" quiet full disabled={save.isPending || thread.data == null} icon={<PaperclipIcon size={16} />}
            onClick={() => { save.mutate({ text, files, approve: false }); }}>
            רק לשמור
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** Under the approval card: the counts, or the way in. A viewer sees the counts only, and nothing when there are none. */
export function ReviewThreadEntry({
  transactionId,
  holdWrites,
  approveDisabled,
  onApprove,
}: {
  transactionId: string | null | undefined;
  holdWrites: boolean;
  approveDisabled: boolean;
  onApprove: () => void;
}) {
  const id = transactionId ?? "";
  const counts = useThreadCounts(id === "" ? [] : [id]);
  const [open, setOpen] = useState(false);
  if (id === "" || counts.isPending) return null;
  const { notes, files } = threadCount(counts.data, id);
  if (holdWrites && notes + files === 0) return null;
  return (
    <>
      <button type="button" className="ui-review-thread m-press" disabled={holdWrites} onClick={() => { setOpen(true); }}>
        <PaperclipIcon size={16} />
        {reviewThreadLabel(notes, files)}
      </button>
      {holdWrites ? null : (
        <BeforeApproveSheet open={open} onOpenChange={setOpen} transactionId={id} approveDisabled={approveDisabled} onApprove={onApprove} />
      )}
    </>
  );
}
