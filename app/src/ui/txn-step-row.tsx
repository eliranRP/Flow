import { useEffect, useRef, useState, type Ref, type RefObject } from "react";
import { cx } from "./cx";
import { ReviewCount, reviewCountDigits } from "./review-count";
import { TextLink } from "./text-link";

/**
 * True while the mark (the end of the stepped content) sits below the row's top edge, that is while
 * card content is scrolled under the row. A card that ends above the row leaves it false.
 */
function useContentUnder(mark: RefObject<HTMLElement | null>, row: RefObject<HTMLElement | null>): boolean {
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const node = mark.current;
    if (node == null || typeof IntersectionObserver === "undefined") return;
    const height = row.current?.offsetHeight ?? 0;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const floor = entry.rootBounds?.bottom ?? window.innerHeight - height;
        setUnder(!entry.isIntersecting && entry.boundingClientRect.top >= floor);
      },
      { rootMargin: `0px 0px -${String(height)}px 0px` },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [mark, row]);
  return under;
}

export type TxnStepRowProps = {
  /** 1-based place of this card in the list. */
  index: number;
  total: number;
  /** No previous card: הקודמת is hidden and keeps its box. */
  atStart: boolean;
  /** No next card: הבאה is hidden and keeps its box. */
  atEnd: boolean;
  onPrev: () => void;
  onNext: () => void;
  prevRef?: Ref<HTMLButtonElement>;
  nextRef?: Ref<HTMLButtonElement>;
  /** The counter; focus waits here when the pressed word is hidden at a list end. */
  countRef?: Ref<HTMLParagraphElement>;
  /** FLOW-314: הבאה is loading the list's next page; the card stays put until it lands. */
  nextBusy?: boolean;
};

/**
 * FLOW-345 option D: הקודמת · "3 מתוך 12" · הבאה, a quiet row pinned at the bottom of the screen, in the
 * thumb zone. At a list end that side's word is hidden but keeps its box, so the counter stays centred.
 * A hairline shows on top only while card content is scrolled under the row. Render it after the
 * stepped content: a 1px mark before the row tells it where that content ends.
 */
export function TxnStepRow({ index, total, atStart, atEnd, onPrev, onNext, prevRef, nextRef, countRef, nextBusy = false }: TxnStepRowProps) {
  const mark = useRef<HTMLDivElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const under = useContentUnder(mark, row);
  const digits = reviewCountDigits(total);
  const place = `${String(index)} מתוך ${String(total)}`;
  return (
    <>
      <div ref={mark} className="ui-txn-step-end" aria-hidden="true" />
      <div
        ref={row}
        className="ui-txn-step"
        role="group"
        aria-label="מעבר בין תנועות"
        data-toast-floor=""
        data-under={under ? "" : undefined}
      >
        <TextLink className={cx("ui-txn-step-btn", atStart && "ui-txn-step-off")} chevron={false} label="התנועה הקודמת" buttonRef={prevRef} onClick={onPrev}>
          הקודמת
        </TextLink>
        <p ref={countRef} className="ui-txn-step-count" tabIndex={-1}>
          {/* The reserved digits are drawing only; a screen reader hears the plain place. */}
          <span aria-hidden="true">
            <ReviewCount value={index} digits={digits} side="index" />
            {" מתוך "}
            <ReviewCount value={total} digits={digits} side="total" />
          </span>
          <span className="sr-only">{place}</span>
        </p>
        <TextLink className={cx("ui-txn-step-btn", atEnd && "ui-txn-step-off")} chevron={false} label="התנועה הבאה" buttonRef={nextRef} onClick={onNext} busy={nextBusy}>
          הבאה
        </TextLink>
      </div>
    </>
  );
}
