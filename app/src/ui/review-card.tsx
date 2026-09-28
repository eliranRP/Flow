import type { ReactNode } from "react";
import { formatAmount } from "./big-number";
import { DocumentIcon } from "./icons";

type ReviewCardProps = {
  supplier: string;
  sourceLine: string;
  netAgorot: bigint;
  vatLine: string;
  suggestion?: ReactNode;
};

/** The document, the amount, and the suggestion. Actions sit outside this card. */
export function ReviewCard({ supplier, sourceLine, netAgorot, vatLine, suggestion }: ReviewCardProps) {
  const shown = netAgorot < 0n ? -netAgorot : netAgorot;
  return (
    <article className="ui-review">
      <div className="ui-review-doc">
        <span className="ui-review-tile" aria-hidden="true">
          <DocumentIcon size={24} />
        </span>
        <div className="ui-review-copy">
          <h2 className="ui-review-supplier t-title-3" title={supplier}>
            {supplier}
          </h2>
          <p className="t-hint">{sourceLine}</p>
        </div>
      </div>
      <p className="t-display">
        <bdi dir="ltr">{formatAmount(shown)}</bdi>
      </p>
      <p className="t-hint">{vatLine}</p>
      {suggestion}
    </article>
  );
}
