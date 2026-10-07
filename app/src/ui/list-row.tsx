import { useId, type ReactNode, type Ref } from "react";
import { Link } from "react-router-dom";
import { BigNumber } from "./big-number";
import { cx } from "./cx";
import { BankIcon, ChevronIcon, DocumentIcon, GripIcon } from "./icons";
import { Skeleton } from "./skeleton";

type Common = {
  title: ReactNode;
  /** Muted line above the title. Project and category rows use it. */
  eyebrow?: string;
  hint?: ReactNode;
  /** The hint wraps instead of ending in an ellipsis. */
  wrapHint?: boolean;
  /** Hint uses t-hint, and the control points at it with aria-describedby. */
  describeHint?: boolean;
  href?: string;
  state?: unknown;
  action?: ReactNode;
  /** The action sits under the row, on the end side. */
  actionBelow?: boolean;
  icon?: ReactNode;
  chevron?: boolean;
  grip?: boolean;
  /** Hidden categories use a muted name. */
  muted?: boolean;
  meta?: ReactNode;
  /** Small tint after the title. The change sheet uses "הצעה". */
  tag?: ReactNode;
  /** Replaces the accessible name. Summary rows say "פרויקט: X, שינוי". */
  label?: string;
  /** An email or other Latin value. The title stays LTR so the start remains visible. */
  ltrTitle?: boolean;
  className?: string;
  /** Warning paints the hint and the icon. Muted paints the icon like the hint. */
  tone?: "warning" | "muted";
  /** The hint slot holds a skeleton bar, at the real hint line height. */
  skelHint?: boolean;
  /** The hint is a polite status, so a failure is announced. */
  hintStatus?: boolean;
  /** The title is a heading. Only a static row uses it. The expired assistant sheet does. */
  heading?: boolean;
};

export type ListRowProps =
  | (Common & {
    variant: "project";
    agorot: bigint;
    loss?: boolean;
    currency?: string;
    amounts?: { minor: bigint; currency: string }[];
    amountDirection?: "expense" | "income";
  })
  | (Common & { variant: "transaction"; agorot: bigint; sign: "in" | "out"; source: "invoice" | "bank"; currency?: string })
  | (Common & { variant: "item"; plain?: boolean })
  | (Common & { variant: "static"; busy?: boolean })
  | (Common & { variant: "button"; onClick?: () => void; busy?: boolean; expanded?: boolean; disabled?: boolean; ariaDisabled?: boolean; buttonRef?: Ref<HTMLButtonElement>; clearHint?: boolean })
  | { variant: "skeleton" }
  | (Common & { variant: "danger"; onClick: () => void; busy?: boolean; disabled?: boolean; buttonRef?: Ref<HTMLButtonElement> })
  | (Common & { variant: "selectable"; selected: boolean; onSelect: () => void });

export function ListRow(props: ListRowProps) {
  const hintId = useId();
  if (props.variant === "skeleton") {
    return (
      <div className="ui-row" aria-hidden="true">
        <span className="ui-skel-copy">
          <Skeleton width="md" />
          <Skeleton width="sm" />
        </span>
        <Skeleton width="sm" />
      </div>
    );
  }
  const described = props.describeHint === true && props.hint != null ? hintId : undefined;
  const softDisabled = props.variant === "button" && props.ariaDisabled === true;
  const rowDisabled = ((props.variant === "button" || props.variant === "danger") && props.disabled === true) || softDisabled;
  const busyRow = props.variant === "button" && props.busy === true;
  const showChevron = props.chevron === true && props.variant !== "static" && !rowDisabled && !busyRow;
  const toneClass = props.tone === "warning" ? "ui-row-tone-warning" : props.tone === "muted" ? "ui-row-tone-muted" : false;
  const baseIcon =
    props.icon ??
    (props.variant === "transaction" ? props.source === "bank" ? <BankIcon /> : <DocumentIcon size={24} /> : null);
  // A busy action row shows a spinner in place of its icon, so a tap visibly started.
  const icon = busyRow && baseIcon ? <span className="ui-spinner" aria-hidden="true" /> : baseIcon;
  const blockCopy = props.variant === "static";
  const CopyMain = blockCopy ? "div" : "span";
  const CopyText = blockCopy ? "div" : "span";
  const titleClass = cx("ui-row-title", props.muted && "ui-row-title-muted", props.tag ? "ui-row-title-with-tag" : false);
  const titleDir = props.ltrTitle ? "ltr" : undefined;
  const titleBody = (
    <>
      {props.tag ? <span className="ui-row-title-text">{titleText(props)}</span> : titleText(props)}
      {props.tag}
    </>
  );
  const body = (
    <>
      {props.grip ? (
        <span className="ui-grip" aria-hidden="true">
          <GripIcon />
        </span>
      ) : null}
      <CopyMain className="ui-row-main">
        {icon ? <span className="ui-row-icon">{icon}</span> : null}
        <CopyText className="ui-row-text">
          {props.eyebrow ? <span className="ui-row-hint">{props.eyebrow}</span> : null}
          {props.heading && blockCopy ? (
            <h3 className={titleClass} dir={titleDir}>{titleBody}</h3>
          ) : (
            <span className={titleClass} dir={titleDir}>{titleBody}</span>
          )}
          {props.hint != null ? (
            <span
              id={described}
              role={props.hintStatus ? "status" : undefined}
              className={cx("ui-row-hint", props.describeHint === true && "t-hint", props.wrapHint && "ui-row-hint-wrap", props.skelHint && "ui-row-hint-skel")}
            >
              {props.hint}
            </span>
          ) : null}
        </CopyText>
      </CopyMain>
      {props.variant === "project" || props.variant === "transaction" ? <RowAmount {...props} /> : null}
      {props.meta ? <span className="ui-row-meta t-hint">{props.meta}</span> : null}
      {props.actionBelow ? null : props.action}
      {showChevron ? (
        <span className="ui-row-chevron" aria-hidden="true">
          <ChevronIcon />
        </span>
      ) : null}
    </>
  );

  if (props.variant === "static") {
    return (
      <div
        className={cx("ui-row", toneClass, props.className)}
        role={described ? "group" : undefined}
        aria-label={described ? rowName(props) : undefined}
        aria-describedby={described}
        aria-busy={props.busy === true || undefined}
      >
        {body}
      </div>
    );
  }
  if (props.variant === "button") {
    return (
      <button
        ref={props.buttonRef}
        type="button"
        className={cx("ui-row", "ui-hit", toneClass, props.clearHint === true && rowDisabled && "ui-row-clear-hint", props.className)}
        disabled={props.disabled === true}
        aria-disabled={softDisabled || undefined}
        aria-busy={props.busy === true}
        aria-expanded={props.expanded}
        aria-label={described ? rowName(props) : props.label}
        aria-describedby={described}
        onClick={() => {
          // A busy row stays focusable but ignores taps, so one run cannot start twice.
          if (props.disabled === true || props.ariaDisabled === true || props.busy === true) return;
          props.onClick?.();
        }}
      >
        {body}
      </button>
    );
  }
  if (props.variant === "danger") {
    return (
      <button
        ref={props.buttonRef}
        type="button"
        className="ui-row ui-hit ui-row-danger"
        disabled={props.disabled === true || props.busy === true}
        aria-busy={props.busy === true}
        aria-label={described ? rowName(props) : undefined}
        aria-describedby={described}
        onClick={props.onClick}
      >
        {body}
      </button>
    );
  }
  if (props.variant === "selectable") {
    return (
      <button type="button" className="ui-row ui-hit" aria-pressed={props.selected} onClick={props.onSelect}>
        {body}
      </button>
    );
  }

  const className = cx(
    props.variant === "project"
      ? "ui-row ui-row-project ui-hit"
      : props.variant === "item" && props.plain === true
        ? "ui-row"
        : "ui-row ui-hit",
    toneClass,
  );
  const row = props.href ? (
    <Link
      to={props.href}
      state={props.state}
      className={className}
      aria-label={described ? rowName(props) : props.label}
      aria-describedby={described}
    >
      {body}
    </Link>
  ) : (
    <div className={className} role={described ? "group" : undefined} aria-label={described ? rowName(props) : undefined} aria-describedby={described}>
      {body}
    </div>
  );
  return withAction(props, row);
}

function rowName(props: { label?: string; title: ReactNode }): string | undefined {
  if (props.label) return props.label;
  return typeof props.title === "string" ? props.title : undefined;
}

function titleText(props: Common): ReactNode {
  if (!props.ltrTitle) return props.title;
  return <bdi dir="ltr">{props.title}</bdi>;
}

function withAction(props: { actionBelow?: boolean; action?: ReactNode }, row: ReactNode) {
  if (!props.actionBelow || props.action == null) return row;
  return (
    <div className="ui-row-stack">
      {row}
      <div className="ui-row-action">{props.action}</div>
    </div>
  );
}

function RowAmount(props: Extract<ListRowProps, { variant: "project" | "transaction" }>) {
  if (props.variant === "transaction") {
    const abs = props.agorot < 0n ? -props.agorot : props.agorot;
    return (
      <span className="t-title-3">
        <BigNumber
          agorot={abs}
          currency={props.currency}
          direction={props.sign === "out" ? "expense" : "income"}
          plus
        />
      </span>
    );
  }
  if (props.amounts != null && props.amounts.length > 0) {
    return (
      <span className="ui-row-amounts t-title-3">
        {props.amounts.map((amount) => (
          <BigNumber
            key={amount.currency}
            agorot={amount.minor}
            currency={amount.currency}
            size="list"
            loss={amount.minor < 0n}
          />
        ))}
      </span>
    );
  }
  return (
    <BigNumber
      agorot={props.agorot}
      currency={props.currency}
      size="list"
      loss={props.loss === true}
      direction={props.amountDirection}
    />
  );
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-project-list", className)}>{children}</div>;
}
