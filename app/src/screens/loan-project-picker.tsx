import { useEffect, useState, type Ref } from "react";
import { RadioRow } from "../ui/radio-row";
import { SearchField } from "../ui/search-field";
import { Skeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { Sheet } from "../ui/sheet";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { useHoldWrites } from "../use-is-viewer";
import { LoanReadError, type LoanBalanceRow } from "./loan-match";

export const NO_PROJECT = "ללא פרויקט";
/** More projects than this get a search field (guide §7.12). */
const PROJECT_SEARCH_FROM = 8;
const projectSkeleton = ["a", "b", "c", "d"] as const;

export type LoanProjectChoice = { id: string; name: string; status?: "active" | "finished"; code?: string | null };

export type LoanProjectField = {
  /** null shows ללא פרויקט. */
  name: string | null;
  onOpen: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
};

/** Where the picker's projects come from: the dashboard in the app, a list in stories. */
export type LoanProjectSource = {
  rows: readonly LoanProjectChoice[];
  loading?: boolean;
  error?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
};

/** FLOW-119. ללא פרויקט first, then active projects and the current one even if finished. */
export function LoanProjectPicker({
  source,
  selectedId,
  saving,
  onSelect,
}: {
  source: LoanProjectSource;
  selectedId: string | null;
  /** The row being written. Absent when nothing is saving. */
  saving?: { id: string | null };
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const loading = source.loading === true;
  const failed = !loading && source.error === true;
  const listed = source.rows.filter((row) => row.status !== "finished" || row.id === selectedId);
  const needle = query.trim();
  const searchable = !loading && !failed && listed.length > PROJECT_SEARCH_FROM;
  const lowered = needle.toLowerCase();
  const shown = searchable && needle !== ""
    ? listed.filter((row) => row.name.includes(needle) || (row.code ?? "").toLowerCase().includes(lowered))
    : listed;
  // "או קוד" only once a project has a code to search by.
  const withCodes = listed.some((row) => row.code != null && row.code !== "");
  const busy = saving != null;
  return (
    <div className="ui-change-picker">
      {searchable ? (
        <SearchField
          label="חיפוש פרויקט"
          value={query}
          onChange={setQuery}
          placeholder={withCodes ? "חיפוש פרויקט או קוד" : "חיפוש פרויקט"}
          autoFocus={false}
        />
      ) : null}
      <div role="radiogroup" aria-label="פרויקט">
        <RadioRow
          layout="picker"
          label={NO_PROJECT}
          selected={selectedId == null}
          busy={busy && saving.id == null}
          disabled={busy && saving.id != null}
          onSelect={() => { onSelect(null); }}
        />
        {loading || failed ? null : shown.map((row) => (
          <RadioRow
            key={row.id}
            layout="picker"
            label={row.name}
            code={row.code ?? undefined}
            description={row.status === "finished" ? "הסתיים" : undefined}
            selected={row.id === selectedId}
            busy={busy && saving.id === row.id}
            disabled={busy && saving.id !== row.id}
            onSelect={() => { onSelect(row.id); }}
          />
        ))}
      </div>
      {loading ? (
        <div aria-busy="true">
          <p className="sr-only" role="status">טוען…</p>
          {projectSkeleton.map((key) => (
            <div className="ui-radio-row" key={key} aria-hidden="true">
              <Skeleton width="md" />
            </div>
          ))}
        </div>
      ) : null}
      {failed ? (
        <LoanReadError label="פרויקטים" busy={source.retrying === true} onRetry={() => { source.onRetry?.(); }} />
      ) : null}
      {!loading && !failed && listed.length === 0 ? <p className="t-hint">אין עדיין פרויקטים.</p> : null}
      {searchable && needle !== "" && shown.length === 0 ? <p className="t-hint">לא נמצא פרויקט בשם הזה</p> : null}
    </div>
  );
}

export function projectNameOf(source: LoanProjectSource, id: string | null): string | null {
  if (id == null) return null;
  return source.rows.find((row) => row.id === id)?.name ?? null;
}

function projectFailure(error: Error): string {
  const code = (error as { code?: string }).code;
  if (code === "42501") return "אין הרשאה לעדכן הלוואה.";
  if (code === "23503") return "הפרויקט לא נמצא.";
  return "לא הצלחנו לעדכן את הפרויקט.";
}

/** FLOW-119. An existing loan: the sheet is the picker, and a tap saves (0075). */
export function LoanProjectSheet({
  loan,
  open,
  onOpenChange,
  source,
  returnFocusRef,
  busyRef,
}: {
  loan: LoanBalanceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: LoanProjectSource;
  returnFocusRef: { current: HTMLElement | null };
  /** True while a tap is saving. The parent's Back handler waits on it. */
  busyRef?: { current: boolean };
}) {
  const toast = useToast();
  const holdWrites = useHoldWrites();
  const [picked, setPicked] = useState<string | null>(loan?.projectId ?? null);
  const [saving, setSaving] = useState<{ id: string | null } | undefined>(undefined);
  useEffect(() => {
    if (open) setPicked(loan?.projectId ?? null);
  }, [open, loan?.id, loan?.projectId]);
  const save = useWrite<{ loanId: string; projectId: string | null }>({
    failure: projectFailure,
    keys: ["loans", "project"],
    onSuccess: ({ projectId }) => {
      toast.show({ message: projectId == null ? "ההלוואה הוסרה מהפרויקט" : "ההלוואה שויכה לפרויקט" });
      onOpenChange(false);
    },
    run: async ({ loanId, projectId }) => {
      if (holdWrites) throw new Error("preview");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase.from("loans").update({ project_id: projectId }).eq("id", loanId).select("id");
      assertNoError(result);
      // RLS filters a refused row without an error: no row back is a refusal.
      if ((result.data ?? []).length === 0) throw Object.assign(new Error("refused"), { code: "42501" });
    },
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving != null) return;
        onOpenChange(next);
      }}
      title="פרויקט"
      hint={loan?.name}
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-fit"
    >
      <LoanProjectPicker
        source={source}
        selectedId={picked}
        saving={saving}
        onSelect={(id) => {
          if (loan == null || saving != null) return;
          if (id === (loan.projectId ?? null)) {
            onOpenChange(false);
            return;
          }
          const previous = picked;
          setPicked(id);
          setSaving({ id });
          if (busyRef) busyRef.current = true;
          save.mutate({ loanId: loan.id, projectId: id }, {
            onError: () => { setPicked(previous); },
            onSettled: () => {
              if (busyRef) busyRef.current = false;
              setSaving(undefined);
            },
          });
        }}
      />
    </Sheet>
  );
}
