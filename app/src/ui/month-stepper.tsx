import { IconButton } from "./icon-button";
import { OutwardChevron } from "./icons";

/**
 * FLOW-362 (cycle 15, C15-6): a month page's earlier and later chevrons, at the end of its title.
 * As on the period bar, › on the start side goes to the earlier month and ‹ to the later one; both
 * are SVG and point outward. A side with no month to open (the current month has no later one, the
 * first month of the books no earlier one) keeps an empty slot, so the other chevron stays put.
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
      {earlier != null ? (
        <IconButton
          label={earlier}
          className="ui-month-step-arrow"
          onClick={() => {
            onStep(-1);
          }}
        >
          <OutwardChevron side="start" />
        </IconButton>
      ) : (
        <span className="ui-month-step-slot" aria-hidden="true" />
      )}
      {later != null ? (
        <IconButton
          label={later}
          className="ui-month-step-arrow"
          onClick={() => {
            onStep(1);
          }}
        >
          <OutwardChevron side="end" />
        </IconButton>
      ) : (
        <span className="ui-month-step-slot" aria-hidden="true" />
      )}
    </div>
  );
}
