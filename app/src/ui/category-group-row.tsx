import { useId, type ReactNode } from "react";
import { BigNumber } from "./big-number";
import { ChevronDownIcon } from "./icons";

/** The hidden word of each up mark: one icon, two meanings. */
export const UP_MARK_LABEL = { high: "גבוה מהרגיל", new: "חדש" } as const;

/** FLOW-401 v5: the one signal on a category, a small amber up arrow. The hidden word names it. */
export function UpMark({ kind }: { kind: keyof typeof UP_MARK_LABEL }) {
  return (
    <span className="ui-up-mark" role="img" aria-label={UP_MARK_LABEL[kind]}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5M6 11l6-6 6 6" />
      </svg>
    </span>
  );
}

/**
 * A group of categories as one row that opens in place (FLOW-401). The down chevron turns
 * when open; the members follow, indented, with no rule between them.
 */
export function CategoryGroupRow({
  name,
  agorot,
  currency,
  up = null,
  expanded,
  onToggle,
  children,
}: {
  name: string;
  agorot: bigint;
  currency?: string;
  /** A member is above its usual month (high) or new this month. */
  up?: keyof typeof UP_MARK_LABEL | null;
  expanded: boolean;
  onToggle: () => void;
  /** The member rows, shown while open. */
  children: ReactNode;
}) {
  const membersId = useId();
  return (
    <>
      <button
        type="button"
        className="ui-row ui-row-project ui-hit ui-group-row"
        aria-expanded={expanded}
        aria-controls={membersId}
        onClick={onToggle}
      >
        <span className="ui-row-main">
          <span className="ui-row-text">
            <span className="ui-row-title">{name}</span>
          </span>
        </span>
        {up != null ? <UpMark kind={up} /> : null}
        <BigNumber agorot={agorot} currency={currency} size="list" loss={false} />
        <span className="ui-group-caret" aria-hidden="true">
          <ChevronDownIcon size={20} />
        </span>
      </button>
      <div id={membersId} className="ui-group-members" hidden={!expanded}>
        {expanded ? children : null}
      </div>
    </>
  );
}
