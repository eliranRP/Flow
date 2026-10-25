// FLOW-957 (board "A · Thread — transaction page"): the line's notes and files under the transaction,
// Mercury's note first with its files, then the owner's notes oldest first, and the composer last.
import { useId, useRef, useState } from "react";
import {
  THREAD_COUNTS_KEY,
  THREAD_FILE_TYPES,
  THREAD_KEY,
  THREAD_NOTE_MAX,
  addThreadNote,
  editThreadNote,
  fileSizeLabel,
  removeThreadFile,
  removeThreadNote,
  threadFileProblem,
  threadFileUrl,
  threadItems,
  uploadThreadFile,
  useThreadQuery,
  type ThreadFile,
  type ThreadNote,
} from "../transaction-thread";
import { useToast } from "../ui/toast";
import { useWrite } from "../use-write";
import { Button } from "../ui/button";
import { CloseIcon, DocumentIcon, PaperclipIcon, PencilIcon, SendIcon, TrashIcon } from "../ui/icons";
import "../ui/css/58-transaction-thread.css";

const THREAD_KEYS = [THREAD_KEY, THREAD_COUNTS_KEY] as const;
const TIME = new Intl.DateTimeFormat("he-IL", { timeZone: "Asia/Jerusalem", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function threadTime(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : TIME.format(at).replace(",", "");
}

/** The line under Mercury's note once it was edited in Flow (Mercury keeps its own text). */
export function mercuryNoteStatus(note: ThreadNote | null): string | null {
  return note?.edited_in_flow ? `נערך ב־Flow ${threadTime(note.updated_at)} · ב־Mercury ההערה לא השתנתה` : null;
}

/** Opens a file from the private bucket in a new tab, through a ten-minute link. */
function openThreadFile(path: string, onFail: () => void): void {
  const tab = window.open("", "_blank");
  void threadFileUrl(path).then((url) => {
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else {
      window.location.assign(url);
    }
  }).catch(() => {
    tab?.close();
    onFail();
  });
}

export function ThreadFileChip({ file, onRemove }: { file: ThreadFile; onRemove?: () => void }) {
  const toast = useToast();
  return (
    <span className="ui-thread-file">
      <button
        type="button"
        className="ui-thread-file-open m-press"
        onClick={() => { openThreadFile(file.path, () => { toast.show({ tone: "bad", message: "הקובץ לא נפתח" }); }); }}
      >
        <DocumentIcon size={16} />
        <bdi dir="auto" className="ui-thread-file-name">{file.file_name}</bdi>
        <span className="ui-thread-file-size">{fileSizeLabel(file.bytes)}</span>
      </button>
      {onRemove ? (
        <button type="button" className="ui-thread-file-remove" aria-label={`הסרת ${file.file_name}`} onClick={onRemove}>
          <CloseIcon size={14} />
        </button>
      ) : null}
    </span>
  );
}

/** Mercury's note (and its files), editable in place. The edit stays in Flow: nothing goes to Mercury. */
export function MercuryNoteCard({
  note,
  files,
  holdWrites,
  compact = false,
}: {
  note: ThreadNote | null;
  files: ThreadFile[];
  holdWrites: boolean;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const fieldId = useId();
  const save = useWrite<{ id: string; body: string }>({
    keys: THREAD_KEYS,
    run: async ({ id, body }) => { await editThreadNote(id, body); },
    success: "נשמר ב־Flow",
    failure: "ההערה לא נשמרה",
    onSuccess: () => { setEditing(false); },
  });
  return (
    <article className="ui-thread-item ui-thread-mercury" data-compact={compact ? "true" : undefined}>
      <span className="ui-thread-avatar" aria-hidden="true">M</span>
      <div className="ui-thread-bubble">
        <div className="ui-thread-head">
          <span className="ui-thread-who">הערה מ־Mercury</span>
          {note != null && !holdWrites && !editing ? (
            <Button variant="link" quiet icon={<PencilIcon size={16} />} onClick={() => { setDraft(note.body); setEditing(true); }}>
              עריכה
            </Button>
          ) : null}
        </div>
        {editing && note != null ? (
          <div className="ui-thread-edit">
            <label htmlFor={fieldId} className="sr-only">הערה מ־Mercury</label>
            <textarea
              id={fieldId}
              dir="auto"
              className="ui-thread-field"
              rows={3}
              maxLength={THREAD_NOTE_MAX}
              value={draft}
              onChange={(event) => { setDraft(event.target.value); }}
            />
            <div className="ui-thread-edit-actions">
              <span className="t-caption t-muted">נשמר ב־Flow בלבד. ב־Mercury ההערה לא משתנה</span>
              <Button variant="link" quiet disabled={save.isPending} onClick={() => { setEditing(false); }}>ביטול</Button>
              <Button
                busy={save.isPending}
                disabled={draft.trim() === "" || draft.trim() === note.body}
                onClick={() => { save.mutate({ id: note.id, body: draft }); }}
              >
                שמירה
              </Button>
            </div>
          </div>
        ) : note != null ? (
          <p className="ui-thread-body"><bdi dir="auto">{note.body}</bdi></p>
        ) : null}
        {files.length > 0 ? (
          <div className="ui-thread-files">{files.map((file) => <ThreadFileChip key={file.id} file={file} />)}</div>
        ) : null}
        {mercuryNoteStatus(note) == null ? null : <span className="ui-thread-meta">{mercuryNoteStatus(note)}</span>}
      </div>
    </article>
  );
}

function OwnNote({ note, files, holdWrites }: { note: ThreadNote; files: ThreadFile[]; holdWrites: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const fieldId = useId();
  const save = useWrite<{ id: string; body: string }>({
    keys: THREAD_KEYS,
    run: async ({ id, body }) => { await editThreadNote(id, body); },
    failure: "ההערה לא נשמרה",
    onSuccess: () => { setEditing(false); },
  });
  const remove = useWrite<string>({ keys: THREAD_KEYS, run: removeThreadNote, success: "ההערה נמחקה", failure: "ההערה לא נמחקה" });
  const removeFile = useWrite<string>({ keys: THREAD_KEYS, run: removeThreadFile, success: "הקובץ הוסר", failure: "הקובץ לא הוסר" });
  const own = note.mine && !holdWrites;
  return (
    <article className="ui-thread-item">
      <span className="ui-thread-avatar ui-thread-avatar-own" aria-hidden="true">{note.mine ? "את" : "צ"}</span>
      <div className="ui-thread-bubble">
        <div className="ui-thread-head">
          <span className="ui-thread-who">
            {`${note.mine ? "את/ה" : "צוות"} · ${threadTime(note.created_at)}${note.edited ? " · נערך" : ""}`}
          </span>
          {own && !editing ? (
            <span className="ui-thread-tools">
              <button type="button" className="ui-thread-tool" aria-label="עריכת ההערה" onClick={() => { setDraft(note.body); setEditing(true); }}>
                <PencilIcon size={16} />
              </button>
              <button type="button" className="ui-thread-tool" aria-label="מחיקת ההערה" disabled={remove.isPending} onClick={() => { remove.mutate(note.id); }}>
                <TrashIcon size={16} />
              </button>
            </span>
          ) : null}
        </div>
        {editing ? (
          <div className="ui-thread-edit">
            <label htmlFor={fieldId} className="sr-only">ההערה</label>
            <textarea id={fieldId} dir="auto" className="ui-thread-field" rows={3} maxLength={THREAD_NOTE_MAX} value={draft} onChange={(event) => { setDraft(event.target.value); }} />
            <div className="ui-thread-edit-actions">
              <Button variant="link" quiet disabled={save.isPending} onClick={() => { setEditing(false); }}>ביטול</Button>
              <Button busy={save.isPending} disabled={draft.trim() === "" || draft.trim() === note.body} onClick={() => { save.mutate({ id: note.id, body: draft }); }}>
                שמירה
              </Button>
            </div>
          </div>
        ) : (
          <p className="ui-thread-body"><bdi dir="auto">{note.body}</bdi></p>
        )}
        {files.length > 0 ? (
          <div className="ui-thread-files">
            {files.map((file) => (
              <ThreadFileChip key={file.id} file={file} onRemove={own && file.mine ? () => { removeFile.mutate(file.id); } : undefined} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function LooseFile({ file, holdWrites }: { file: ThreadFile; holdWrites: boolean }) {
  const removeFile = useWrite<string>({ keys: THREAD_KEYS, run: removeThreadFile, success: "הקובץ הוסר", failure: "הקובץ לא הוסר" });
  return (
    <article className="ui-thread-item">
      <span className="ui-thread-avatar ui-thread-avatar-own" aria-hidden="true">{file.mine ? "את" : "צ"}</span>
      <div className="ui-thread-bubble ui-thread-bubble-plain">
        <span className="ui-thread-who">{`${file.mine ? "את/ה" : "צוות"} · ${threadTime(file.created_at)}`}</span>
        <div className="ui-thread-files">
          <ThreadFileChip file={file} onRemove={file.mine && !holdWrites ? () => { removeFile.mutate(file.id); } : undefined} />
        </div>
      </div>
    </article>
  );
}

export type ThreadDraft = { text: string; files: File[] };

/** Saves a draft: the note (when there is text) and each file on it. */
export async function saveThreadDraft(companyId: string, transactionId: string, draft: ThreadDraft): Promise<void> {
  const text = draft.text.trim();
  const noteId = text === "" ? null : await addThreadNote(transactionId, text);
  for (const file of draft.files) await uploadThreadFile(companyId, transactionId, noteId, file);
}

/** The picked files, each with a ✕, under a composer. */
export function DraftFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (files.length === 0) return null;
  return (
    <div className="ui-thread-files ui-thread-draft-files">
      {files.map((file, index) => (
        <span key={`${file.name}-${String(index)}`} className="ui-thread-file">
          <span className="ui-thread-file-open">
            <DocumentIcon size={16} />
            <bdi dir="auto" className="ui-thread-file-name">{file.name}</bdi>
            <span className="ui-thread-file-size">{fileSizeLabel(file.size)}</span>
          </span>
          <button type="button" className="ui-thread-file-remove" aria-label={`הסרת ${file.name}`} onClick={() => { onRemove(index); }}>
            <CloseIcon size={14} />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Adds the picked files that the bucket takes; tells the owner about any it does not. */
export function usePickFiles(setFiles: (update: (files: File[]) => File[]) => void) {
  const toast = useToast();
  return (list: FileList | null) => {
    const picked = [...(list ?? [])];
    const problems = picked.map((file) => threadFileProblem(file)).filter((problem): problem is string => problem != null);
    if (problems[0]) toast.show({ tone: "bad", message: problems[0] });
    setFiles((files) => [...files, ...picked.filter((file) => threadFileProblem(file) == null)].slice(0, 10));
  };
}

function Composer({ companyId, transactionId }: { companyId: string; transactionId: string }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const pick = usePickFiles(setFiles);
  const send = useWrite<ThreadDraft>({
    keys: THREAD_KEYS,
    run: (draft) => saveThreadDraft(companyId, transactionId, draft),
    failure: "ההערה לא נשמרה",
    onSuccess: () => {
      setText("");
      setFiles([]);
    },
  });
  const empty = text.trim() === "" && files.length === 0;
  return (
    <div className="ui-thread-composer">
      <DraftFiles files={files} onRemove={(index) => { setFiles((list) => list.filter((_, at) => at !== index)); }} />
      <div className="ui-thread-composer-row">
        <button type="button" className="ui-thread-round" aria-label="צירוף קובץ" onClick={() => { fileInput.current?.click(); }}>
          <PaperclipIcon />
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept={THREAD_FILE_TYPES.join(",")}
          onChange={(event) => {
            pick(event.target.files);
            event.target.value = "";
          }}
        />
        <label htmlFor={fieldId} className="sr-only">הוספת הערה</label>
        <textarea
          id={fieldId}
          dir="auto"
          rows={1}
          className="ui-thread-field ui-thread-composer-field"
          placeholder="הוספת הערה…"
          maxLength={THREAD_NOTE_MAX}
          value={text}
          onChange={(event) => { setText(event.target.value); }}
        />
        <button
          type="button"
          className="ui-thread-round ui-thread-send"
          aria-label="שליחה"
          disabled={empty || send.isPending}
          onClick={() => { send.mutate({ text, files }); }}
        >
          {send.isPending ? <span className="ui-spinner" aria-hidden="true" /> : <SendIcon />}
        </button>
      </div>
    </div>
  );
}

/** The thread section of the transaction page. Nothing shows until the read answers; a failed read shows nothing. */
export function TransactionThread({ transactionId, holdWrites }: { transactionId: string; holdWrites: boolean }) {
  const thread = useThreadQuery(transactionId);
  if (thread.data == null) return null;
  const items = threadItems(thread.data);
  const count = thread.data.notes.length + thread.data.files.length;
  return (
    <section className="ui-thread" aria-labelledby={`thread-${transactionId}`}>
      <div className="ui-thread-title">
        <h2 id={`thread-${transactionId}`} className="t-section">הערות וקבצים</h2>
        {count > 0 ? <span className="ui-thread-count">{count}</span> : null}
      </div>
      {items.length === 0 ? <p className="t-caption t-muted ui-thread-empty">עוד אין כאן הערות או קבצים.</p> : null}
      <div className="ui-thread-list">
        {items.map((item) => {
          if (item.kind === "mercury") return <MercuryNoteCard key="mercury" note={item.note} files={item.files} holdWrites={holdWrites} />;
          if (item.kind === "note") return <OwnNote key={item.note.id} note={item.note} files={item.files} holdWrites={holdWrites} />;
          return <LooseFile key={item.file.id} file={item.file} holdWrites={holdWrites} />;
        })}
      </div>
      {holdWrites ? null : <Composer companyId={thread.data.company_id} transactionId={transactionId} />}
    </section>
  );
}
