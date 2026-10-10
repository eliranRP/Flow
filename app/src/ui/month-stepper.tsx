import { useId } from "react";
import { IconButton } from "./icon-button";
import { OutwardChevron } from "./icons";

/**
 * FLOW-362 (cycle 15, C15-6): a month page's earlier and later chevrons, at the end of its title.
 * As on the period bar, › on the start side goes to the earlier month and ‹ to the later one; both
 * are SVG and point outward, inside one quiet rounded segment so they read as a pager. A side with no month to open (the current month has no later one, the
 * first month of the books no earlier one) shows its chevron dimmed and disabled, so the pager keeps its shape.
 */
export function MonthStepper({
  earlier,
  later,
  onStep,
}: {
  /** The earlier month's name for the chevron ("תזרים אוגוסט"), or null for none. */
  earlier: string | null;
  later: string | null;
  onStep: (delta: -1 | 1) => void;
}) {
  return (
    <div className="ui-month-step">
      <StepArrow
        label={earlier}
        side="start"
        onClick={() => {
          onStep(-1);
        }}
      />
      <StepArrow
        label={later}
        side="end"
        onClick={() => {
          onStep(1);
        }}
      />
    </div>
  );
}

/**
 * One chevron. With no month to open it stays in place, dimmed (the owner's call, 2026-10-10), and
 * focusable with aria-disabled, as the period bar's arrows are, so a screen reader hears why.
 */
function StepArrow({ label, side, onClick }: { label: string | null; side: "start" | "end"; onClick: () => void }) {
  const reasonId = useId();
  const off = label == null;
  return (
    <>
      <IconButton
        label={label ?? (side === "start" ? "חודש קודם" : "חודש הבא")}
        className="ui-month-step-arrow"
        aria-disabled={off || undefined}
        aria-describedby={off ? reasonId : undefined}
        onClick={() => {
          if (!off) onClick();
        }}
      >
        <OutwardChevron side={side} />
      </IconButton>
      {off ? <span id={reasonId} className="sr-only">{side === "start" ? "זה החודש הראשון" : "זה החודש הנוכחי"}</span> : null}
    </>
  );
}
