import type { ReactNode } from "react";
import { formatAmount } from "./big-number";
import { DocumentIcon } from "./icons";

type ReviewCardProps = {
  supplier: string;
  date: string;
  netAgorot: bigint;
  vatLine: string;
  suggestion?: ReactNode;
  actions: ReactNode;
};

/** One review item. The queue shows a single card at a time. */
export function ReviewCard({ supplier, date, netAgorot, vatLine, suggestion, actions }: ReviewCardProps) {
  return (
    <article className="ui-review">
      <span className="ui-row-icon">
        <DocumentIcon size={24} />
      </span>
      <h2 className="t-title-3">{supplier}</h2>
      <p className="t-hint">{date}</p>
      <p className="t-title-2">
        <bdi dir="ltr">{formatAmount(netAgorot)}</bdi>
      </p>
      <p className="t-hint">{vatLine}</p>
      {suggestion}
      <div className="stack">{actions}</div>
    </article>
  );
}
