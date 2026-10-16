// FLOW-369: the add form's container. It reads the projects and categories, makes the write (a manual
// line, or a document on a matched bank line), and shows the toast with ביטול. The form is
// AddEntryView (add-entry-view.tsx).
import { useRef, useState } from "react";
import { planSave, emptyDraft, documentProblem, type AttachedDocument, type EntryDraft, type EntryKind, NO_PROJECT, todayDisplayDate } from "../add-entry";
import { documentOf } from "../add-entry-doc";
import { useHomePreview } from "../preview";
import { useToast } from "../ui/toast";
import { formatAmount } from "../ui/amount";
import { useCategoriesQuery, useDashboardQuery, useInvalidateBooks } from "../use-books";
import { attachDocument, createCategoryNamed, createProjectNamed, saveManualLine, undoAttach, undoManualLine, useReceiptMatch } from "../use-add-entry";
import { AddEntryView } from "./add-entry-view";

export function AddEntrySheet({ kind, initialDocument = null, fromProjectId = null, onDone, onClose }: {
  kind: EntryKind;
  initialDocument?: AttachedDocument | null;
  fromProjectId?: string | null;
  onDone: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const preview = useHomePreview();
  const dashboard = useDashboardQuery();
  const categories = useCategoriesQuery();
  const [draft, setDraft] = useState<EntryDraft>(() => emptyDraft(fromProjectId, todayDisplayDate()));
  const [document, setDocument] = useState<AttachedDocument | null>(initialDocument);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const matchQuery = useReceiptMatch(draft, kind === "receipt");
  const match = kind === "receipt" ? (matchQuery.data ?? null) : null;

  const projects = (dashboard.data?.projects ?? [])
    .filter((project) => project.status === "active")
    .map((project) => ({ id: project.id, name: project.name }));
  const cats = (categories.data ?? [])
    .filter((category) => !category.hidden && category.loan_part == null)
    .map((category) => ({ id: category.id, name: category.name, kind: category.kind }));
  const fromProjectName = fromProjectId == null ? null : (projects.find((p) => p.id === fromProjectId)?.name ?? "");

  async function pickFile(file: File | undefined) {
    if (file == null) return;
    const problem = documentProblem(file);
    if (problem != null) {
      setError(problem === "size" ? "הקובץ גדול מדי (עד 25 MB)." : "אפשר לצרף PDF או תמונה.");
      return;
    }
    setError(null);
    setDocument(await documentOf(file));
  }

  function projectName(id: string | null): string {
    if (id === NO_PROJECT || id == null) return "בלי פרויקט";
    return projects.find((p) => p.id === id)?.name ?? "";
  }

  async function save(next: EntryDraft) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const plan = planSave(kind, match, document != null);
      if (preview === "off") {
        if (plan.kind === "attach" && document != null) {
          await attachDocument(plan.transactionId, document);
          await invalidate();
          const supplier = match?.description ?? "";
          toast.show({
            message: `הקבלה צורפה לתנועה של ${supplier}`,
            action: "ביטול",
            onAction: () => { void undoAttach(plan.transactionId, document.sha256).then(() => invalidate()); },
          });
        } else {
          const id = await saveManualLine(next, kind);
          if (plan.kind === "create" && plan.attachDocument && document != null) await attachDocument(id, document);
          await invalidate();
          const word = next.direction === "in" ? "ההכנסה" : "ההוצאה";
          toast.show({
            message: `${word} נשמרה · ${projectName(next.projectId)}`,
            action: "ביטול",
            onAction: () => { void undoManualLine(id).then(() => invalidate()); },
          });
        }
      }
      onDone();
    } catch {
      setError("לא הצלחנו לשמור. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AddEntryView
        kind={kind}
        fromProject={fromProjectName}
        projects={projects}
        categories={cats}
        draft={draft}
        onDraftChange={setDraft}
        document={document}
        match={match}
        busy={busy}
        error={error}
        formatMoney={(minor) => formatAmount(BigInt(minor), "detail")}
        onClose={onClose}
        onSave={(next) => { void save(next); }}
        onAddProject={async (name) => {
          const id = await createProjectNamed(name);
          await invalidate(["dashboard"]);
          toast.show({ message: `נוצר פרויקט ${name}` });
          return id;
        }}
        onAddCategory={async (name, catKind) => {
          const id = await createCategoryNamed(name, catKind);
          await invalidate(["categories"]);
          toast.show({ message: `נוצרה קטגוריה ${name}` });
          return id;
        }}
        onAttach={kind === "cash" ? () => { picker.current?.click(); } : undefined}
      />
      <input
        ref={picker}
        type="file"
        accept="image/*,application/pdf"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => { void pickFile(event.target.files?.[0]); event.target.value = ""; }}
      />
    </>
  );
}
