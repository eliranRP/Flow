// FLOW-957 (board "C · Sheet — approval card"): the approval card's row for the note and files, and the
// "לפני שמאשרים" sheet it opens: the line's one note (Mercury's, or the owner's) to edit, its files, a
// photo or a file to add, then "לשמור ולאשר".
import { useId, useRef, useState } from "react";
import {
  THREAD_COUNTS_KEY,
  THREAD_FILE_TYPES,
  THREAD_KEY,
  THREAD_NOTE_MAX,
  threadCount,
  threadNote,
  useThreadCounts,
  useThreadQuery,
} from "../transaction-thread";
import { Button } from "../ui/button";
import { CameraIcon, CheckIcon, DocumentIcon, NoteIcon, PaperclipIcon } from "../ui/icons";
import { Sheet } from "../ui/sheet";
import { useWrite } from "../use-write";
import { DraftFiles, mercuryNoteStatus, saveThreadDraft, ThreadFileChip, usePickFiles, type ThreadDraft } from "./transaction-thread";
import "../ui/css/58-transaction-thread.css";

/** The row's words: what the line holds, or the way in when it holds nothing. */
export function reviewThreadLabel(notes: number, files: number): string {
  if (notes === 0 && files === 0) return "הוספת הערה או קובץ";
  return [
    notes > 0 ? "הערה" : null,
    files === 1 ? "קובץ" : files > 1 ? `${String(files)} קבצים` : null,
  ].filter(Boolean).join(" · ");
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
  const note = thread.data == null ? null : threadNote(thread.data);
  const mercury = note?.source === "mercury";
  // null: untouched, so the field shows the line's note as it is.
  const [text, setText] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const pick = usePickFiles((picked) => { setFiles((list) => [...list, ...picked].slice(0, 10)); });
  const shown = text ?? note?.body ?? "";
  const changed = text != null && text.trim() !== "" && text.trim() !== note?.body;
  const empty = !changed && files.length === 0;
  const save = useWrite<ThreadDraft & { approve: boolean }>({
    keys: [THREAD_KEY, THREAD_COUNTS_KEY],
    run: async (draft) => {
      const companyId = thread.data?.company_id;
      if (!companyId) throw new Error("thread");
      await saveThreadDraft(companyId, transactionId, draft, note);
    },
    failure: files.length > 0 && !changed ? "הקובץ לא נשמר" : "ההערה לא נשמרה",
    onSuccess: ({ approve }) => {
      setText(null);
      setFiles([]);
      onOpenChange(false);
      if (approve) onApprove();
    },
  });
  const onPicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    pick(event.target.files);
    event.target.value = "";
  };
  const draft = { text: changed ? text : "", files };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="לפני שמאשרים" busy={save.isPending}>
      <div className="ui-before-approve">
        <label htmlFor={fieldId} className="ui-thread-who">{mercury ? "הערה מ־Mercury" : "הערה"}</label>
        <textarea
          ref={field}
          id={fieldId}
          dir="auto"
          rows={3}
          className="ui-thread-field"
          placeholder="מה חשוב לזכור על התנועה הזו?"
          maxLength={THREAD_NOTE_MAX}
          value={shown}
          onChange={(event) => { setText(event.target.value); }}
        />
        {mercury && changed ? <span className="t-caption t-muted">נשמר ב־Flow בלבד. ב־Mercury ההערה לא משתנה</span> : null}
        {mercury && !changed && mercuryNoteStatus(note) != null ? <span className="ui-thread-meta">{mercuryNoteStatus(note)}</span> : null}
        {thread.data != null && thread.data.files.length > 0 ? (
          <div className="ui-thread-files">{thread.data.files.map((file) => <ThreadFileChip key={file.id} file={file} />)}</div>
        ) : null}
        <DraftFiles files={files} onRemove={(index) => { setFiles((list) => list.filter((_, at) => at !== index)); }} />
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
            save.mutate({ ...draft, approve: true });
          }}
        >
          {empty ? "לאשר" : "לשמור ולאשר"}
        </Button>
        {empty ? null : (
          <Button variant="link" quiet full disabled={save.isPending || thread.data == null} icon={<PaperclipIcon size={16} />}
            onClick={() => { save.mutate({ ...draft, approve: false }); }}>
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
