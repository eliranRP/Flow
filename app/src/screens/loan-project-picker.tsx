import { useState, type Ref } from "react";
import { RadioRow } from "../ui/radio-row";
import { SearchField } from "../ui/search-field";
import { Skeleton } from "../ui/skeleton";
import { LoanReadError } from "./loan-match";

export const NO_PROJECT = "ללא פרויקט";
/** More projects than this get a search field (guide §7.13). */
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
