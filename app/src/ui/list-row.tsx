import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BigNumber } from "./big-number";
import { cx } from "./cx";
import { BankIcon, DocumentIcon } from "./icons";

type Common = {
  title: string;
  hint?: ReactNode;
  href?: string;
  action?: ReactNode;
  icon?: ReactNode;
};

export type ListRowProps =
  | (Common & { variant: "project"; agorot: bigint; loss?: boolean })
  | (Common & { variant: "transaction"; agorot: bigint; sign: "in" | "out"; source: "invoice" | "bank" })
  | (Common & { variant: "item" })
  | (Common & { variant: "static" })
  | (Common & { variant: "button"; onClick: () => void; busy?: boolean })
  | (Common & { variant: "danger"; onClick: () => void; busy?: boolean; disabled?: boolean })
  | (Common & { variant: "selectable"; selected: boolean; onSelect: () => void });

export function ListRow(props: ListRowProps) {
  const icon =
    props.icon ??
    (props.variant === "transaction" ? props.source === "bank" ? <BankIcon /> : <DocumentIcon size={24} /> : null);
  const body = (
    <>
      <span className="ui-row-main">
        {icon ? <span className="ui-row-icon">{icon}</span> : null}
        <span className="ui-row-text">
          <span className="ui-row-title" title={props.title}>
            {props.title}
          </span>
          {props.hint ? <span className="ui-row-hint">{props.hint}</span> : null}
        </span>
      </span>
      {props.variant === "project" || props.variant === "transaction" ? <RowAmount {...props} /> : null}
      {props.action}
    </>
  );

  if (props.variant === "static") {
    return <div className="ui-row">{body}</div>;
  }
  if (props.variant === "button") {
    return (
      <button type="button" className="ui-row ui-hit" aria-busy={props.busy === true} onClick={props.onClick}>
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
  if (props.href) {
    return (
      <Link to={props.href} className={className}>
        {body}
      </Link>
    );
  }
  return <div className={className}>{body}</div>;
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

export function List({ children }: { children: ReactNode }) {
  return <div className={cx("ui-project-list")}>{children}</div>;
}
