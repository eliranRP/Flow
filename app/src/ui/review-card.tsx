import { useLayoutEffect, useState, type CSSProperties, type Ref } from "react";
import { formatAmountText } from "@flow/shared";
import { lineSplitPartsLabel } from "../line-split-copy";
import { REVIEW_FLAG_PREFIX, type CopyPart, type ReviewFlagView, type ReviewPaidView } from "../review-copy";
import { methodLabel, type TxnMeta } from "../txn-meta";
import { MethodIcon } from "./bank-details";
import { AlertIcon, CheckIcon, ChevronDownIcon, DocumentIcon, NoteIcon } from "./icons";
import { ListRow } from "./list-row";
import { Skeleton } from "./skeleton";
import { TextLink } from "./text-link";
import { JevTag, ReversalTag, SuggestTag } from "./suggest-tag";

/** FLOW-312 item 2 / decision 0125: a split line whose bank amount changed. */
export const SPLIT_MISMATCH_LINE = "הפיצול לא תואם את סכום השורה בבנק.";
/** FLOW-333 C2: the bar's primary on a split_mismatch card. */
export const SPLIT_MISMATCH_ACTION = "עדכון הפיצול";
/** FLOW-333 C2: the bar's secondary on a split_mismatch card; it approves the line as it stands. */
export const SPLIT_MISMATCH_KEEP = "להשאיר כך";
/** The mismatch sentence. להשאיר כך points at it with aria-describedby. */
export const REVIEW_MISMATCH_ID = "review-mismatch";
/** FLOW-327: both fields are missing. The bar's first button points at it. */
export const REVIEW_MISSING_BOTH = "בחרו פרויקט וקטגוריה";
export const REVIEW_MISSING_ID = "review-missing";
/** FLOW-702: the auto job wrote Jev's values on this line; ביטול takes the fill back (decision 0145). */
export const JEV_FILLED = "מולא ע״י Jev";
export const JEV_FILLED_UNDO = "ביטול";

/** Draws copy parts, each number in its own bdi. */
export function CopyLine({ parts }: { parts: readonly CopyPart[] }) {
  return (
    <>
      {parts.map((part, index) => (typeof part === "string"
        ? <span key={index}>{part}</span>
        : <bdi key={index} className="ui-num" dir="ltr">{part.num}</bdi>))}
    </>
  );
}

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
  /** FLOW-703: Jev suggests no project (overhead). Shown on an empty project row with הצעת Jev. */
  projectNoneJev?: boolean;
};

/** FLOW-703: Jev's "no project / overhead" answer on the project row. תקורה first: at 320 the row cuts the end. */
export const JEV_NO_PROJECT = "תקורה · ללא פרויקט";

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
   * FLOW-333 C8: on a `split_mismatch` card, the number of parts. The field rows become one
   * static row "מפוצל · N חלקים"; "loading" holds the row with a skeleton.
   */
  splitParts?: number | "loading";
  /** FLOW-327: why Jev suggests this, one line under the rows. Shown only with a הצעת Jev pill. */
  jevWhy?: readonly CopyPart[] | null;
  /** FLOW-327: at most one anomaly flag, the last block of the card (decision 0131). */
  flag?: ReviewFlagView | null;
  /** FLOW-327: both fields are missing. The card ends with "בחרו פרויקט וקטגוריה". */
  missingBoth?: boolean;
  /**
   * FLOW-702: Jev's auto fill stands on this line. The card says "✦ מולא ע״י Jev" under the rows, one
   * line with no reason (the owner's pick, so it never wraps), and ביטול when `onUndo` is set (a viewer gets
   * the label only). Shown only with a הצעת Jev pill, or with `alone` (FLOW-706: Jev is off, so the
   * card shows the stored values without the pill, and the fill stays undoable).
   */
  jevFilled?: { onUndo?: () => void; busy?: boolean; alone?: boolean } | null;
  /** A storyboard frame (the setup demos, FLOW-506): pending rows hold a still skeleton, no shine. */
  still?: boolean;
  /**
   * FLOW-309 (decision 0165): a connector invoice with its receipts. One muted line under the amount
   * (and the VAT line): "✓ שולם · קבלה dd/mm", or "שולם חלקית · קבלה dd/mm" with no ✓. `reviewPaidView`.
   */
  paid?: ReviewPaidView | null;
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
  splitParts,
  jevWhy,
  flag,
  missingBoth = false,
  jevFilled,
  still = false,
  paid,
}: ReviewCardProps) {
  const method = methodLabel(meta);
  const memo = meta?.memo ?? null;
  const shown = netAgorot < 0n ? -netAgorot : netAgorot;
  const amountText = formatAmountText(shown, currency, {
    detail: true,
    direction,
  });
  // A long amount steps its size down to fit a narrow card; it is never cut or wrapped (FLOW-327).
  const figureFit = { "--figure-chars": amountText.length } as CSSProperties;
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
  const projectNone = projectValue == null && suggestion?.projectNoneJev === true;
  if (projectValue || onProject || projectNone) {
    lines.push({
      key: "project",
      label: "פרויקט",
      value: projectValue ?? (projectNone ? JEV_NO_PROJECT : "לא נבחר"),
      suggested: (suggestion?.projectSuggested === true && projectValue != null) || projectNone,
      jev: (suggestion?.projectSuggested === true && suggestion.projectJev === true && projectValue != null) || projectNone,
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
  const note = shared ? "הוצאה משותפת · אישור יפתח\u00A0פיצול" : null;
  const mismatch = reason === "split_mismatch";
  const jevOnCard = !pending && lines.some((line) => line.jev);
  const why = jevOnCard && jevWhy != null && jevWhy.length > 0 ? jevWhy : null;
  const spike = flag?.spike ?? null;
  const filled = jevFilled != null && !pending && (jevOnCard || jevFilled.alone === true) ? jevFilled : null;
  // FLOW-704: a row Jev may fill holds a skeleton while the read waits; the ✦ line under the rows is held
  // too (text hidden), so a fill that lands keeps the card's height.
  // A shared cost takes no project from Jev, so its card holds nothing either.
  const jevSlot = pending && !mismatch && !shared && lines.some((line) => line.value === "לא נבחר" || line.suggested);
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
      {spike?.pill ? (
        <div className="ui-review-amount">
          <p className="t-display ui-review-figure" style={figureFit}>
            <bdi dir="ltr">{amountText}</bdi>
          </p>
          <span className="ui-status ui-review-spike" aria-hidden="true">
            <bdi className="ui-num" dir="ltr">{spike.pill}</bdi>
          </span>
          <span className="sr-only">{spike.spoken}</span>
        </div>
      ) : (
        <p className="t-display ui-review-figure" style={figureFit}>
          <bdi dir="ltr">{amountText}</bdi>
        </p>
      )}
      {spike?.usual ? <p className="t-hint ui-review-usual"><CopyLine parts={spike.usual} /></p> : null}
      {vatLine ? <p className="t-hint">{vatLine}</p> : null}
      {paid ? <ReviewPaidLine paid={paid} /> : null}
      {memo ? <ReviewMemo memo={memo} /> : null}
      <div className="ui-review-ai">
        {mismatch ? (
          <ListRow
            variant="static"
            className="ui-review-split-row"
            title={splitParts === "loading" ? <Skeleton width="sm" /> : splitParts == null ? "מפוצל" : <SplitPartsTitle count={splitParts} />}
          />
        ) : lines.map((line) => pending && (line.value === "לא נבחר" || line.suggested) ? (
          <div className="ui-row ui-hit" aria-hidden="true" key={line.key}>
            <span className="ui-row-main">
              <span className="ui-row-text">
                <span className="ui-row-hint">{line.label}</span>
                <span className="ui-row-title"><Skeleton width="md" still={still} /></span>
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
        {filled ? (
          <p className="t-hint ui-review-reason ui-review-filled">
            <span className="ui-review-reason-mark" aria-hidden="true">✦</span>
            <span className="ui-review-reason-text">
              {JEV_FILLED}
            </span>
            {filled.onUndo ? (
              <TextLink
                className="ui-review-filled-undo"
                size="hint"
                chevron={false}
                busy={filled.busy === true}
                label={`${JEV_FILLED_UNDO} המילוי של Jev`}
                onClick={filled.onUndo}
              >
                {JEV_FILLED_UNDO}
              </TextLink>
            ) : null}
          </p>
        ) : null}
        {why && !filled ? (
          <p className="t-hint ui-review-reason">
            <span className="ui-review-reason-mark" aria-hidden="true">✦</span>
            <span className="ui-review-reason-text"><CopyLine parts={why} /></span>
          </p>
        ) : null}
        {jevSlot ? (
          <p className="t-hint ui-review-reason ui-review-reason-slot" aria-hidden="true">
            <span className="ui-review-reason-mark">✦</span>
            <span className="ui-review-reason-text">{"\u00A0"}</span>
          </p>
        ) : null}
        {note == null ? null : pending ? (
          <p className="t-label ui-review-note-slot" aria-hidden="true" />
        ) : (
          <p className="t-label">{note}</p>
        )}
        {mismatch ? (
          <p className="t-label ui-review-mismatch" id={REVIEW_MISMATCH_ID}>{SPLIT_MISMATCH_LINE}</p>
        ) : null}
        {missingBoth && !mismatch ? (
          <p className="t-hint ui-review-missing" id={REVIEW_MISSING_ID}>{REVIEW_MISSING_BOTH}</p>
        ) : null}
      </div>
      {/* A spike pill is the whole warning: no row at the end repeats it (design lead, 2026-10-09). */}
      {flag && spike?.pill == null && (flag.tone === "loud" || flag.line.length > 0) ? <ReviewFlagBlock flag={flag} /> : null}
    </article>
  );
}

/** FLOW-309: the paid line. Readers hear "שולם, קבלה מ־12/10" instead of the ✓ and the "·". */
function ReviewPaidLine({ paid }: { paid: ReviewPaidView }) {
  return (
    <p className="t-hint ui-review-paid">
      {paid.check ? (
        <span className="ui-review-paid-icon" aria-hidden="true">
          <CheckIcon size={16} />
        </span>
      ) : null}
      <span className="ui-review-paid-text" aria-hidden="true">
        <CopyLine parts={paid.line} />
      </span>
      <span className="sr-only">{paid.spoken}</span>
    </p>
  );
}

/** "מפוצל · N חלקים" with the number in a bdi; one part says "חלק אחד". */
function SplitPartsTitle({ count }: { count: number }) {
  if (count === 1) return <>{lineSplitPartsLabel(1)}</>;
  return (
    <>
      {"מפוצל · "}
      <bdi className="ui-num" dir="ltr">{String(count)}</bdi>
      {" חלקים"}
    </>
  );
}

/**
 * Loud: a warning row with the icon, the title in the text colour and the hint in warning.
 * Quiet: one muted hint line. Both start with a hidden "לבדיקה:". Never a control.
 * An amount spike's "↑ N%" and usual amount sit by the amount instead, with no row here (2026-10-09).
 */
function ReviewFlagBlock({ flag }: { flag: ReviewFlagView }) {
  if (flag.tone === "loud") {
    return (
      <ListRow
        variant="static"
        tone="warning"
        className="ui-review-flag"
        icon={<AlertIcon size={20} />}
        title={(
          <>
            <span className="sr-only">{`${REVIEW_FLAG_PREFIX} `}</span>
            <CopyLine parts={flag.title} />
          </>
        )}
        hint={flag.hint == null ? undefined : <CopyLine parts={flag.hint} />}
        wrapHint
      />
    );
  }
  return (
    <p className="t-hint ui-review-flag-quiet">
      <span className="ui-review-flag-icon" aria-hidden="true"><AlertIcon size={16} /></span>
      <span className="ui-review-flag-text">
        <span className="sr-only">{`${REVIEW_FLAG_PREFIX} `}</span>
        <CopyLine parts={flag.line} />
      </span>
    </p>
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
