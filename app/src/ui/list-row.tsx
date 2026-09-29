import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { BigNumber } from "./big-number";
import { cx } from "./cx";
import { BankIcon, ChevronIcon, DocumentIcon, GripIcon } from "./icons";
import { Skeleton } from "./skeleton";

type Common = {
  title: string;
  /** Muted line above the title. Project and category rows use it. */
  eyebrow?: string;
  hint?: ReactNode;
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
};

export type ListRowProps =
  | (Common & { variant: "project"; agorot: bigint; loss?: boolean })
  | (Common & { variant: "transaction"; agorot: bigint; sign: "in" | "out"; source: "invoice" | "bank" })
  | (Common & { variant: "item" })
  | (Common & { variant: "static" })
  | (Common & { variant: "button"; onClick: () => void; busy?: boolean; expanded?: boolean; disabled?: boolean; buttonRef?: Ref<HTMLButtonElement>; clearHint?: boolean })
  | { variant: "skeleton" }
  | (Common & { variant: "danger"; onClick: () => void; busy?: boolean; disabled?: boolean })
  | (Common & { variant: "selectable"; selected: boolean; onSelect: () => void });

export function ListRow(props: ListRowProps) {
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
  const rowDisabled = (props.variant === "button" || props.variant === "danger") && props.disabled === true;
  const showChevron = props.chevron === true && props.variant !== "static" && !rowDisabled;
  const icon =
    props.icon ??
    (props.variant === "transaction" ? props.source === "bank" ? <BankIcon /> : <DocumentIcon size={24} /> : null);
  const body = (
    <>
      {props.grip ? (
        <span className="ui-grip" aria-hidden="true">
          <GripIcon />
        </span>
      ) : null}
      <span className="ui-row-main">
        {icon ? <span className="ui-row-icon">{icon}</span> : null}
        <span className="ui-row-text">
          {props.eyebrow ? <span className="ui-row-hint">{props.eyebrow}</span> : null}
          <span className={cx("ui-row-title", props.muted && "ui-row-title-muted", props.tag ? "ui-row-title-with-tag" : false)}>
            {props.tag ? <span className="ui-row-title-text">{props.title}</span> : props.title}
            {props.tag}
          </span>
          {props.hint ? <span className="ui-row-hint">{props.hint}</span> : null}
        </span>
      </span>
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
    return <div className="ui-row">{body}</div>;
  }
  if (props.variant === "button") {
    return (
      <button
        ref={props.buttonRef}
        type="button"
        className={cx("ui-row", "ui-hit", props.clearHint === true && props.disabled === true && "ui-row-clear-hint")}
        disabled={props.disabled === true}
        aria-busy={props.busy === true}
        aria-expanded={props.expanded}
        aria-label={props.label}
        onClick={props.onClick}
      >
        {body}
      </button>
    );
  }
  if (props.variant === "danger") {
    return (
      <button
        type="button"
        className="ui-row ui-hit ui-row-danger"
        disabled={props.disabled === true || props.busy === true}
        aria-busy={props.busy === true}
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

  const className = props.variant === "project" ? "ui-row ui-row-project ui-hit" : "ui-row ui-hit";
  const row = props.href ? (
    <Link to={props.href} state={props.state} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
  return withAction(props, row);
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
    const text = props.sign === "out" ? `−` : `+`;
    return (
      <span className="t-title-3">
        <span aria-hidden="true">{text}</span>
        <BigNumber agorot={abs} />
      </span>
    );
  }
  return <BigNumber agorot={props.agorot} size="list" loss={props.loss === true} />;
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("ui-project-list", className)}>{children}</div>;
}
