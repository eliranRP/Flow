import { useId, type ReactNode, type Ref } from "react";
import { Button } from "./button";
import { cx } from "./cx";
import { ChevronIcon } from "./icons";

type CommonProps = {
  /** A 24px outline icon, drawn in text-secondary. */
  icon: ReactNode;
  label: string;
  value: string;
  /** An empty value reads as a prompt, such as "בחרו פרויקט", in accent text. */
  valueTone?: "accent";
  /** A muted line under the value (13px). The row names it with aria-describedby. */
  hint?: ReactNode;
  /** A small mark after the value, such as the reversal tag. */
  tag?: ReactNode;
  /** The board's two-line fact row: the label is the bold title and the value the muted line under it. */
  titled?: boolean;
  /** A mark at the end of the row, before the chevron and centred on the row (the recurring row's pace). */
  endTag?: ReactNode;
  /** A line that needs a look: its icon and hint take the warning colour. */
  tone?: "warning";
  /** Replaces the accessible name "label value" when the row needs its own (a loan split names its title). */
  name?: string;
  disabled?: boolean;
  /** A save or load is running: the chevron becomes a spinner, and taps do nothing. */
  busy?: boolean;
  className?: string;
};

/** The row opens something. Its accessible name is "label value". */
type OpenProps = CommonProps & {
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  action?: undefined;
};

/** The row stays put, and its text link at the end does the work (שינוי). */
type ActionProps = CommonProps & {
  onClick?: undefined;
  buttonRef?: undefined;
  action: { label: string; onClick: () => void };
};

/** A fact with nothing to tap. */
type StaticProps = CommonProps & {
  onClick?: undefined;
  buttonRef?: undefined;
  action?: undefined;
};

export type IconRowProps = OpenProps | ActionProps | StaticProps;

/**
 * FLOW-363 (4): a detail page's fact row. The chevron row (`onClick`) is the default; the text link
 * (`action`) is the board's "שינוי" row. Values and labels come from the type roles, and the row
 * takes its press, focus and disabled looks from `.ui-row`.
 */
export function IconRow(props: IconRowProps) {
  const hintId = useId();
  const describedBy = props.hint != null ? hintId : undefined;
  const toneClass = props.tone === "warning" ? "ui-icon-row-warning" : undefined;
  const body = (
    <>
      <span className="ui-icon-row-icon" aria-hidden="true">{props.icon}</span>
      <span className="ui-icon-row-text">
        {props.titled === true ? (
          <>
            <span className="ui-icon-row-value">{props.label}</span>
            <span className="ui-icon-row-hint">{props.value}</span>
          </>
        ) : (
          <>
            <span className="ui-icon-row-label">{props.label}</span>
            <span className="ui-icon-row-value-line">
              <span className={cx("ui-icon-row-value", props.valueTone === "accent" && "ui-icon-row-value-accent")}>{props.value}</span>
              {props.tag}
            </span>
          </>
        )}
        {props.hint != null ? <span id={hintId} className="ui-icon-row-hint">{props.hint}</span> : null}
      </span>
      {props.endTag}
    </>
  );
  if (props.action != null) {
    return (
      <div className={cx("ui-row", "ui-icon-row", toneClass, props.className)} aria-describedby={describedBy}>
        {body}
        <Button variant="link" disabled={props.disabled} busy={props.busy} onClick={props.action.onClick}>
          {props.action.label}
        </Button>
      </div>
    );
  }
  if (props.onClick == null) {
    return <div className={cx("ui-row", "ui-icon-row", toneClass, props.className)} aria-describedby={describedBy}>{body}</div>;
  }
  const onClick = props.onClick;
  return (
    <button
      ref={props.buttonRef}
      type="button"
      className={cx("ui-row", "ui-hit", "m-press", "ui-icon-row", toneClass, props.className)}
      disabled={props.disabled}
      aria-busy={props.busy === true || undefined}
      aria-label={props.name ?? `${props.label} ${props.value}`}
      aria-describedby={describedBy}
      onClick={() => {
        // A busy row stays focusable but ignores taps, so one run cannot start twice.
        if (props.busy === true) return;
        onClick();
      }}
    >
      {body}
      <span className="ui-icon-row-end" aria-hidden="true">
        {props.busy === true ? <span className="ui-spinner" /> : <ChevronIcon size={18} />}
      </span>
    </button>
  );
}
