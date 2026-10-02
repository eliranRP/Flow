import { formatAmount } from "./big-number";
import { DocumentIcon } from "./icons";
import { ListRow } from "./list-row";
import { SuggestTag } from "./suggest-tag";

export type ReviewSuggestion = {
  project?: string;
  category?: string;
  confidence?: number;
  /** This project line is a guess. A split line is never a suggestion. */
  projectSuggested?: boolean;
  /** This category line is a guess. A rule or an owner pick is not. */
  categorySuggested?: boolean;
};

type ReviewCardProps = {
  supplier: string;
  sourceLine: string;
  netAgorot: bigint;
  vatLine: string;
  suggestion?: ReviewSuggestion;
  /** Queue reason. An unallocated shared cost is not a missing project. */
  reason?: string | null;
  /** Income has no project row. */
  direction?: "income" | "expense";
  /** Opens the project picker, or the split when this line is a split. */
  onProject?: () => void;
  /** Opens the category picker. The save is the change sheet's save. */
  onCategory?: () => void;
};

/** The document, the amount, and the suggestion. Actions sit outside this card. */
export function ReviewCard({
  supplier,
  sourceLine,
  netAgorot,
  vatLine,
  suggestion,
  reason,
  direction = "expense",
  onProject,
  onCategory,
}: ReviewCardProps) {
  const shown = netAgorot < 0n ? -netAgorot : netAgorot;
  const shared = reason === "unallocated_shared";
  const projectValue = suggestion?.project;
  const categoryValue = suggestion?.category;
  const lines: Array<{
    key: string;
    label: string;
    value: string;
    suggested: boolean;
    onOpen?: () => void;
  }> = [];
  if (direction !== "income" && (projectValue || onProject)) {
    lines.push({
      key: "project",
      label: "פרויקט",
      value: projectValue ?? "לא נבחר",
      suggested: suggestion?.projectSuggested === true && projectValue != null,
      onOpen: onProject,
    });
  }
  if (categoryValue || onCategory) {
    lines.push({
      key: "category",
      label: "קטגוריה",
      value: categoryValue ?? "לא נבחר",
      suggested: suggestion?.categorySuggested === true && categoryValue != null,
      onOpen: onCategory,
    });
  }
  const note = shared
    ? "הוצאה משותפת · אישור יפתח\u00A0חלוקה"
    : direction === "income"
      ? (categoryValue == null ? "אין הצעה, הקישו לבחירה" : null)
      : categoryValue != null && projectValue == null
        ? "חסר פרויקט, הקישו לבחירה"
        : projectValue != null && categoryValue == null
          ? "חסר קטגוריה, הקישו לבחירה"
          : projectValue == null && categoryValue == null
            ? "אין הצעה, הקישו לבחירה"
            : null;
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
      <div className="ui-review-ai">
        {lines.map((line) => line.onOpen ? (
          <ListRow
            key={line.key}
            variant="button"
            eyebrow={line.label}
            title={line.value}
            label={`${line.label}: ${line.value}`}
            tag={line.suggested ? <SuggestTag /> : undefined}
            chevron
            onClick={line.onOpen}
          />
        ) : (
          <p className="ui-review-line" key={line.key}>
            <span className="t-label">{line.label}</span>
            <span>
              {line.value}
              {line.suggested ? <SuggestTag /> : null}
            </span>
          </p>
        ))}
        {note ? <p className="t-label">{note}</p> : null}
      </div>
    </article>
  );
}
