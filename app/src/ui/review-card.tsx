import { formatAmount } from "./big-number";
import { DocumentIcon } from "./icons";

export type ReviewSuggestion = {
  project?: string;
  category?: string;
  confidence?: number;
};

type ReviewCardProps = {
  supplier: string;
  sourceLine: string;
  netAgorot: bigint;
  vatLine: string;
  suggestion?: ReviewSuggestion;
};

/** The document, the amount, and a rule-based suggestion. Actions sit outside this card. */
export function ReviewCard({ supplier, sourceLine, netAgorot, vatLine, suggestion }: ReviewCardProps) {
  const shown = netAgorot < 0n ? -netAgorot : netAgorot;
  const showSuggestion = suggestion != null && (suggestion.project != null || suggestion.category != null);
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
      {showSuggestion ? (
        <div className="ui-review-ai">
          <p className="t-hint">הצעה</p>
          {suggestion.project ? (
            <p className="ui-review-line">
              <span className="t-label">פרויקט</span>
              <span>{suggestion.project}</span>
            </p>
          ) : null}
          {suggestion.category ? (
            <p className="ui-review-line">
              <span className="t-label">קטגוריה</span>
              <span>
                {suggestion.category}
                {suggestion.confidence == null ? null : (
                  <span className="t-hint">
                    {" "}
                    <bdi dir="ltr">{`${String(suggestion.confidence)}%`}</bdi>
                  </span>
                )}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
