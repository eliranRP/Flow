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

/** The document, the amount, and the suggestion. Actions sit outside this card. */
export function ReviewCard({ supplier, sourceLine, netAgorot, vatLine, suggestion }: ReviewCardProps) {
  const shown = netAgorot < 0n ? -netAgorot : netAgorot;
  const lines = [
    suggestion?.project ? { label: "פרויקט", value: suggestion.project } : null,
    suggestion?.category ? { label: "קטגוריה", value: suggestion.category } : null,
  ].filter((line): line is { label: string; value: string } => line != null);
  const missingProject = suggestion?.category != null && suggestion.project == null;
  return (
    <article className="ui-review">
      <div className="ui-review-doc">
        <span className="ui-review-tile" aria-hidden="true">
          <DocumentIcon size={24} />
        </span>
        <div className="ui-review-copy">
          <h2 className="ui-review-supplier t-title-3">
            {supplier}
          </h2>
          <p className="t-hint">{sourceLine}</p>
        </div>
      </div>
      <p className="t-display">
        <bdi dir="ltr">{formatAmount(shown, "detail")}</bdi>
      </p>
      <p className="t-hint">{vatLine}</p>
      {lines.length > 0 ? (
        <div className="ui-review-ai">
          <p className="t-hint">הצעה</p>
          {lines.map((line) => (
            <p className="ui-review-line" key={line.label}>
              <span className="t-label">{line.label}</span>
              <span>{line.value}</span>
            </p>
          ))}
          {missingProject ? <p className="t-label">חסר פרויקט, בחרו בשינוי</p> : null}
        </div>
      ) : (
        <div className="ui-review-ai">
          <p className="t-label">אין הצעה, בחרו בשינוי</p>
        </div>
      )}
    </article>
  );
}
