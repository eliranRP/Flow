import { useLayoutEffect, useState, type Ref } from "react";
import { formatAmountText } from "@flow/shared";
import { methodLabel, type TxnMeta } from "../txn-meta";
import { MethodIcon } from "./bank-details";
import { ChevronDownIcon, DocumentIcon, NoteIcon } from "./icons";
import { ListRow } from "./list-row";
import { Skeleton } from "./skeleton";
import { TextLink } from "./text-link";
import { JevTag, ReversalTag, SuggestTag } from "./suggest-tag";

/** FLOW-312 item 2 / decision 0125: a split line whose bank amount changed. */
export const SPLIT_MISMATCH_LINE = "הפיצול לא תואם את סכום השורה בבנק.";
export const SPLIT_MISMATCH_ACTION = "עדכון הפיצול";

export type ReviewSuggestion = {
  project?: string;
  category?: string;
  confidence?: number;
  /** This project line is a guess. A split line is never a suggestion. */
  projectSuggested?: boolean;
  /** This category line is a guess. A rule or an owner pick is not. */
  categorySuggested?: boolean;
  /** Jev filled this suggested project. Shows הצעת Jev instead of הצעה. */
  projectJev?: boolean;
  /** Jev filled this suggested category. A supplier rule or an owner pick is not Jev's. */
  categoryJev?: boolean;
  /** The category is of the other kind: a bounced payment or a refund. Shows החזר. */
  categoryReversal?: boolean;
};

type ReviewCardProps = {
  supplier: string;
  sourceLine: string;
  netAgorot: bigint;
  currency?: string;
  vatLine?: string | null;
  suggestion?: ReviewSuggestion;
  /** Queue reason. An unallocated shared cost is not a missing project. */
  reason?: string | null;
  direction?: "income" | "expense";
  /** Opens the project picker, or the split when this line is a split. */
  onProject?: () => void;
  /** Opens the category picker. A line pick saves that field and does not resolve. */
  onCategory?: () => void;
  projectButtonRef?: Ref<HTMLButtonElement>;
  categoryButtonRef?: Ref<HTMLButtonElement>;
  /** Suggested fields hold their row height until the queue's Jev read settles. */
  pending?: boolean;
  /** FLOW-304. Bank details: a method line under the source line, and the memo. */
  meta?: TxnMeta | null;
  /**
   * FLOW-325 / 0125: on a `split_mismatch` review, opens the parts editor. Omitted for a viewer,
   * who still reads the line.
   */
  onFixSplit?: () => void;
};

/** The document, the amount, and the suggestion. Actions sit outside this card. */
export function ReviewCard({
  supplier,
  sourceLine,
  netAgorot,
  currency = "ILS",
  vatLine,
  suggestion,
  reason,
  direction = "expense",
  onProject,
  onCategory,
  projectButtonRef,
  categoryButtonRef,
  pending = false,
  meta,
  onFixSplit,
}: ReviewCardProps) {
  const method = methodLabel(meta);
  const memo = meta?.memo ?? null;
  const shown = netAgorot < 0n ? -netAgorot : netAgorot;
  const amountText = formatAmountText(shown, currency, {
    detail: true,
    direction,
  });
  const shared = reason === "unallocated_shared";
  const projectValue = suggestion?.project;
  const categoryValue = suggestion?.category;
  const lines: Array<{
    key: string;
    label: string;
    value: string;
    suggested: boolean;
    jev: boolean;
    reversal?: boolean;
    onOpen?: () => void;
  }> = [];
  if (projectValue || onProject) {
    lines.push({
      key: "project",
      label: "פרויקט",
      value: projectValue ?? "לא נבחר",
      suggested: suggestion?.projectSuggested === true && projectValue != null,
      jev: suggestion?.projectSuggested === true && suggestion.projectJev === true && projectValue != null,
      onOpen: onProject,
    });
  }
  if (categoryValue || onCategory) {
    lines.push({
      key: "category",
      label: "קטגוריה",
      value: categoryValue ?? "לא נבחר",
      suggested: suggestion?.categorySuggested === true && categoryValue != null,
      jev: suggestion?.categorySuggested === true && suggestion.categoryJev === true && categoryValue != null,
      reversal: suggestion?.categoryReversal === true && categoryValue != null,
      onOpen: onCategory,
    });
  }
  const note = shared ? "הוצאה משותפת · אישור יפתח\u00A0חלוקה" : null;
  const mismatch = reason === "split_mismatch";
  return (
    <article className="ui-review" aria-busy={pending || undefined} data-jev-pending={pending ? "" : undefined}>
      <div className="ui-review-doc">
        <span className="ui-review-tile" aria-hidden="true">
          <DocumentIcon size={24} />
        </span>
        <div className="ui-review-copy">
          <h2 className="ui-review-supplier t-title-3">
            {supplier}
          </h2>
          <p className="t-hint">{sourceLine}</p>
          {method ? (
            <p className="t-hint ui-review-meta">
              <MethodIcon kind={method.icon} />
              {method.icon === "card" && method.short !== method.spoken ? (
                <>
                  <span className="ui-num" dir="ltr" aria-hidden="true">{method.short}</span>
                  <span className="sr-only">{method.spoken}</span>
                </>
              ) : (
                <bdi dir="auto">{method.short}</bdi>
              )}
            </p>
          ) : null}
        </div>
      </div>
      <p className="t-display">
        <bdi dir="ltr">{amountText}</bdi>
      </p>
      {vatLine ? <p className="t-hint">{vatLine}</p> : null}
      {memo ? <ReviewMemo memo={memo} /> : null}
      <div className="ui-review-ai">
        {lines.map((line) => pending && (line.value === "לא נבחר" || line.suggested) ? (
          <div className="ui-row ui-hit" aria-hidden="true" key={line.key}>
            <span className="ui-row-main">
              <span className="ui-row-text">
                <span className="ui-row-hint">{line.label}</span>
                <span className="ui-row-title"><Skeleton width="md" /></span>
              </span>
            </span>
          </div>
        ) : line.onOpen ? (
          <ListRow
            key={line.key}
            variant="button"
            eyebrow={line.label}
            title={line.value}
            muted={line.value === "לא נבחר"}
            label={`${line.label}: ${line.value}${line.jev ? ", הצעת Jev" : line.suggested ? ", הצעה" : line.reversal ? ", החזר" : ""}`}
            tag={lineTag(line)}
            chevron
            buttonRef={line.key === "project" ? projectButtonRef : categoryButtonRef}
            onClick={line.onOpen}
          />
        ) : (
          <ListRow
            key={line.key}
            variant="static"
            eyebrow={line.label}
            title={line.value}
            tag={lineTag(line)}
          />
        ))}
        {note == null ? null : pending ? (
          <p className="t-label ui-review-note-slot" aria-hidden="true" />
        ) : (
          <p className="t-label">{note}</p>
        )}
        {mismatch ? (
          <div className="ui-review-mismatch">
            <p className="t-label">{SPLIT_MISMATCH_LINE}</p>
            {onFixSplit ? (
              <TextLink chevron={false} onClick={onFixSplit}>{SPLIT_MISMATCH_ACTION}</TextLink>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** הצעת Jev on a Jev fill, הצעה on any other suggestion, then החזר. */
function lineTag(line: { suggested: boolean; jev: boolean; reversal?: boolean }) {
  if (line.jev) return <JevTag />;
  if (line.suggested) return <SuggestTag />;
  return line.reversal ? <ReversalTag /> : undefined;
}

/**
 * One memo line with an ellipsis. It is a button only when the text is clipped;
 * a tap shows the whole memo in place. The card remounts per line, so it resets.
 */
function ReviewMemo({ memo }: { memo: string }) {
  const [box, setBox] = useState<HTMLSpanElement | null>(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (box == null || open) return;
    const measure = () => {
      setClipped(box.scrollWidth > box.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, [box, open, memo]);
  const body = (
    <>
      <span className="ui-review-memo-icon" aria-hidden="true">
        <NoteIcon size={16} />
      </span>
      <span className="sr-only">הערה:</span>{" "}
      <span ref={setBox} className="ui-review-memo-text" dir="auto" data-clip-ok="">
        {memo}
      </span>
    </>
  );
  if (!clipped) return <p className="t-hint ui-review-memo">{body}</p>;
  return (
    <button
      type="button"
      className="t-hint ui-review-memo ui-review-memo-button ui-hit"
      aria-expanded={open}
      data-open={open ? "" : undefined}
      onClick={() => {
        setOpen((value) => !value);
      }}
    >
      {body}
      <span className="ui-review-memo-chevron" aria-hidden="true">
        <ChevronDownIcon size={16} />
      </span>
    </button>
  );
}
