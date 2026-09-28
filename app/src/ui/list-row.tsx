import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BigNumber } from "./big-number";
import { cx } from "./cx";
import { BankIcon, DocumentIcon } from "./icons";

type Common = {
  title: string;
  hint?: string;
  href?: string;
  action?: ReactNode;
};

export type ListRowProps =
  | (Common & { variant: "project"; agorot: bigint; loss?: boolean })
  | (Common & { variant: "transaction"; agorot: bigint; sign: "in" | "out"; source: "invoice" | "bank" })
  | (Common & { variant: "item" });

export function ListRow(props: ListRowProps) {
  const body = (
    <>
      <span className="ui-row-main">
        {props.variant === "transaction" ? (
          <span className="ui-row-icon">{props.source === "bank" ? <BankIcon /> : <DocumentIcon size={24} />}</span>
        ) : null}
        <span className="ui-row-text">
          <span className="ui-row-title" title={props.title}>
            {props.title}
          </span>
          {props.hint ? <span className="ui-row-hint">{props.hint}</span> : null}
        </span>
      </span>
      {props.variant === "item" ? null : <RowAmount {...props} />}
      {props.action}
    </>
  );
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

function RowAmount(props: ListRowProps) {
  if (props.variant === "item") return null;
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
