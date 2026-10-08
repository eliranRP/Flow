import { useId } from "react";
import { List, ListRow } from "./list-row";
import type { StatementMethod } from "./statement";
import { TextLink } from "./text-link";

/** FLOW-309: the דולגו section at the end of הצג הכול. */
export const SKIPPED_TITLE = "דולגו";
export const SKIPPED_REOPEN = "החזרה לתור";
export const SKIPPED_LOAD_ERROR = "לא הצלחנו לטעון את הפריטים שדולגו.";
export const SKIPPED_RETRY = "ניסיון חוזר";
/** The section's id: the empty queue's link scrolls to it. */
export const SKIPPED_SECTION_ID = "review-skipped";

/** "פריט אחד דולג", or "{N} פריטים דולגו" with N on its own for a bdi. */
export function skippedCountText(count: number): { num: string | null; words: string } {
  if (count === 1) return { num: null, words: "פריט אחד דולג" };
  return { num: String(count), words: " פריטים דולגו" };
}

/**
 * FLOW-309, owner pick 2026-10-08: under הכל מאושר, a link to the skipped cards in הצג הכול.
 * No skipped cards renders nothing.
 */
export function ReviewSkippedLink({ count, to }: { count: number; to: string }) {
  if (count <= 0) return null;
  const text = skippedCountText(count);
  return (
    <p className="ui-review-empty-skipped">
      <TextLink to={to}>
        {text.num == null ? null : <bdi className="ui-num" dir="ltr">{text.num}</bdi>}
        {text.words}
      </TextLink>
    </p>
  );
}

export type SkippedRowView = {
  /** The review row id: reopen_review takes it. */
  id: string;
  title: string;
  fallback: "bank" | "invoice";
  method?: StatementMethod | null;
  suggestion?: string | null;
  pending?: boolean;
  agorot: bigint;
  currency?: string;
  sign: "in" | "out";
  /** The row opens the transaction. */
  href: string;
};

/**
 * The skipped cards, newest skip first, each a statement row with החזרה לתור under it at the end
 * side. No rows renders nothing. A failed read is the heading, the sentence and ניסיון חוזר.
 */
export function ReviewSkippedList({
  state,
  rows,
  busyId = null,
  onReopen,
  onRetry,
  retrying = false,
}: {
  state: "rows" | "error";
  rows: readonly SkippedRowView[];
  /** The row whose החזרה לתור is writing. */
  busyId?: string | null;
  onReopen?: (id: string) => void;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const headId = useId();
  if (state === "rows" && rows.length === 0) return null;
  return (
    <section className="ui-review-skipped" id={SKIPPED_SECTION_ID} aria-labelledby={headId}>
      <div className="ui-section-head ui-review-skipped-head">
        <h2 className="t-heading" id={headId} tabIndex={-1}>{SKIPPED_TITLE}</h2>
        {state === "rows" ? (
          <span className="t-hint">
            <bdi className="ui-num" dir="ltr">{String(rows.length)}</bdi>
          </span>
        ) : null}
      </div>
      {state === "error" ? (
        <p className="t-hint ui-review-skipped-error" role="status">
          {SKIPPED_LOAD_ERROR}{" "}
          {onRetry ? (
            <TextLink chevron={false} busy={retrying} onClick={onRetry}>{SKIPPED_RETRY}</TextLink>
          ) : null}
        </p>
      ) : (
        <List className="ui-review-skipped-list">
          {rows.map((row) => (
            <div className="ui-row-stack ui-review-skipped-row" key={row.id}>
              <ListRow
                variant="statement"
                title={row.title}
                fallback={row.fallback}
                method={row.method}
                suggestion={row.suggestion}
                pending={row.pending}
                agorot={row.agorot}
                currency={row.currency}
                sign={row.sign}
                href={row.href}
              />
              {onReopen ? (
                <div className="ui-row-action ui-review-skipped-action">
                  <TextLink
                    chevron={false}
                    busy={busyId === row.id}
                    label={`${SKIPPED_REOPEN}: ${row.title}`}
                    onClick={() => {
                      if (busyId != null) return;
                      onReopen(row.id);
                    }}
                  >
                    {SKIPPED_REOPEN}
                  </TextLink>
                </div>
              ) : null}
            </div>
          ))}
        </List>
      )}
    </section>
  );
}
