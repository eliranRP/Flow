// FLOW-957 (board "A · Thread — transaction page"): the line's note and files under the transaction.
// A line holds one note (owner, 2026-10-26): Mercury's, edited in Flow only, or the owner's.
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
  threadNote,
  putThreadFile,
  readPickedFile,
  recordThreadFile,
  useThreadQuery,
  type ThreadFile,
  type ThreadNote,
} from "../transaction-thread";
import { useToast } from "../ui/toast";
import { useWrite } from "../use-write";
import { Button } from "../ui/button";
import { CloseIcon, DocumentIcon, PaperclipIcon, PencilIcon, TrashIcon } from "../ui/icons";
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

/**
 * The line's one note (owner, 2026-10-26): Mercury's note when it has one, edited in Flow only, or the
 * owner's note. With no note yet, a writer adds it here.
 */
export function NoteCard({ note, transactionId, holdWrites }: { note: ThreadNote | null; transactionId: string; holdWrites: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const fieldId = useId();
  const save = useWrite<string>({
    keys: THREAD_KEYS,
    run: async (body) => {
      if (note == null) await addThreadNote(transactionId, body);
      else await editThreadNote(note.id, body);
    },
    success: note?.source === "mercury" ? "נשמר ב־Flow" : undefined,
    failure: "ההערה לא נשמרה",
    onSuccess: () => { setDraft(null); },
  });
  const remove = useWrite<string>({ keys: THREAD_KEYS, run: removeThreadNote, success: "ההערה נמחקה", failure: "ההערה לא נמחקה" });
  if (note == null && holdWrites) return null;
  const mercury = note?.source === "mercury";
  const editing = draft != null || note == null;
  const value = draft ?? "";
  const unchanged = value.trim() === "" || value.trim() === note?.body;
  return (
    <article className={mercury ? "ui-thread-item ui-thread-mercury" : "ui-thread-item"}>
      <span className={mercury ? "ui-thread-avatar" : "ui-thread-avatar ui-thread-avatar-own"} aria-hidden="true">{mercury ? "M" : "F"}</span>
      <div className="ui-thread-bubble">
        <div className="ui-thread-head">
          <span className="ui-thread-who">
            {mercury ? "הערה מ־Mercury" : note == null ? "הערה" : `הערה · ${threadTime(note.updated_at)}`}
          </span>
          {note != null && !holdWrites && !editing ? (
            <span className="ui-thread-tools">
              <button type="button" className="ui-thread-tool" aria-label="עריכת ההערה" onClick={() => { setDraft(note.body); }}>
                <PencilIcon size={16} />
              </button>
              {mercury ? null : (
                <button type="button" className="ui-thread-tool" aria-label="מחיקת ההערה" disabled={remove.isPending} onClick={() => { remove.mutate(note.id); }}>
                  <TrashIcon size={16} />
                </button>
              )}
            </span>
          ) : null}
        </div>
        {editing ? (
          <div className="ui-thread-edit">
            <label htmlFor={fieldId} className="sr-only">{mercury ? "הערה מ־Mercury" : "הערה"}</label>
            <textarea
              id={fieldId}
              dir="auto"
              className="ui-thread-field"
              rows={3}
              placeholder="מה חשוב לזכור על התנועה הזו?"
              maxLength={THREAD_NOTE_MAX}
              value={value}
              onChange={(event) => { setDraft(event.target.value); }}
            />
            <div className="ui-thread-edit-actions">
              {mercury ? <span className="t-caption t-muted">נשמר ב־Flow בלבד. ב־Mercury ההערה לא משתנה</span> : null}
              {note == null ? null : (
                <Button variant="link" quiet disabled={save.isPending} onClick={() => { setDraft(null); }}>ביטול</Button>
              )}
              <Button busy={save.isPending} disabled={unchanged} onClick={() => { save.mutate(value.trim()); }}>
                שמירה
              </Button>
            </div>
          </div>
        ) : (
          <p className="ui-thread-body"><bdi dir="auto">{note.body}</bdi></p>
        )}
        {mercuryNoteStatus(note) == null ? null : <span className="ui-thread-meta">{mercuryNoteStatus(note)}</span>}
      </div>
    </article>
  );
}

/** The line's files, Mercury's and the owner's, and the paperclip that uploads more right away. */
function ThreadFiles({ files, companyId, transactionId, holdWrites }: { files: ThreadFile[]; companyId: string; transactionId: string; holdWrites: boolean }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const upload = useWrite<File[]>({
    keys: THREAD_KEYS,
    run: (picked) => saveThreadDraft(companyId, transactionId, { text: "", files: picked }, null),
    success: "הקובץ נשמר",
    failure: "הקובץ לא נשמר",
  });
  const removeFile = useWrite<string>({ keys: THREAD_KEYS, run: removeThreadFile, success: "הקובץ הוסר", failure: "הקובץ לא הוסר" });
  const pick = usePickFiles((picked) => { upload.mutate(picked); });
  if (holdWrites && files.length === 0) return null;
  return (
    <div className="ui-thread-files">
      {files.map((file) => (
        <ThreadFileChip key={file.id} file={file} onRemove={file.mine && !holdWrites ? () => { removeFile.mutate(file.id); } : undefined} />
      ))}
      {holdWrites ? null : (
        <>
          <button type="button" className="ui-thread-round" aria-label="צירוף קובץ" disabled={upload.isPending} onClick={() => { fileInput.current?.click(); }}>
            {upload.isPending ? <span className="ui-spinner" aria-hidden="true" /> : <PaperclipIcon />}
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
        </>
      )}
    </div>
  );
}

export type ThreadDraft = { text: string; files: File[] };

/**
 * Saves a draft: the files go up first (a failed upload saves nothing), then the line's one note is
 * added or edited when the text is new, then the files are recorded on the line.
 */
export async function saveThreadDraft(companyId: string, transactionId: string, draft: ThreadDraft, note: ThreadNote | null): Promise<void> {
  const text = draft.text.trim();
  const paths: string[] = [];
  for (const file of draft.files) paths.push(await putThreadFile(companyId, transactionId, file));
  if (text !== "" && text !== note?.body) {
    if (note == null) await addThreadNote(transactionId, text);
    else await editThreadNote(note.id, text);
  }
  for (const [index, file] of draft.files.entries()) await recordThreadFile(transactionId, paths[index] ?? "", file);
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

/** Hands on the picked files that the bucket takes; tells the owner about any it does not. */
export function usePickFiles(onPicked: (files: File[]) => void) {
  const toast = useToast();
  return (list: FileList | null) => {
    const picked = [...(list ?? [])];
    const problems = picked.map((file) => threadFileProblem(file)).filter((problem): problem is string => problem != null);
    if (problems[0]) toast.show({ tone: "bad", message: problems[0] });
    // Read now, while the input still holds the files (see readPickedFile).
    void Promise.allSettled(picked.filter((file) => threadFileProblem(file) == null).map(readPickedFile)).then((reads) => {
      const kept = reads.flatMap((read) => (read.status === "fulfilled" ? [read.value] : []));
      if (kept.length < reads.length) toast.show({ tone: "bad", message: "הקובץ לא נקרא. אפשר לבחור אותו שוב" });
      if (kept.length > 0) onPicked(kept.slice(0, 10));
    });
  };
}

/** The thread section of the transaction page: the line's one note and its files. Nothing shows until the read answers; a failed read shows nothing. */
export function TransactionThread({ transactionId, holdWrites }: { transactionId: string; holdWrites: boolean }) {
  const thread = useThreadQuery(transactionId);
  if (thread.data == null) return null;
  const note = threadNote(thread.data);
  if (holdWrites && note == null && thread.data.files.length === 0) return null;
  return (
    <section className="ui-thread" aria-labelledby={`thread-${transactionId}`}>
      <div className="ui-thread-title">
        <h2 id={`thread-${transactionId}`} className="t-section">הערה וקבצים</h2>
      </div>
      <NoteCard key={note?.id ?? "new"} note={note} transactionId={transactionId} holdWrites={holdWrites} />
      <ThreadFiles files={thread.data.files} companyId={thread.data.company_id} transactionId={transactionId} holdWrites={holdWrites} />
    </section>
  );
}
