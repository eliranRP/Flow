import { Link } from "react-router-dom";
import type { ReportShortcut } from "../search-reports";
import { Button } from "../ui/button";
import { BackIcon, DocumentIcon } from "../ui/icons";

/**
 * The first read of a typed search, before any line is in hand (FLOW-368 §2.5): five rows drawn as
 * the board's skeleton (avatar, two bars, an end bar), under a note on the period searched.
 */
export function SearchingRows({ allTime }: { allTime: boolean }) {
  return (
    <div className="ui-search-searching" aria-busy="true">
      <p className="ui-search-searching-note" role="status">{allTime ? "מחפש בכל התקופות…" : "מחפש…"}</p>
      <div className="ui-search-skel-list">
        {[0, 1, 2, 3, 4].map((index) => (
          <div className="ui-search-skel-row" key={index}>
            <span className="ui-search-skel-avatar ui-skeleton-bar" aria-hidden="true" />
            <span className="ui-search-skel-text">
              <span className="ui-skeleton-bar ui-search-skel-bar-long" aria-hidden="true" />
              <span className="ui-skeleton-bar ui-search-skel-bar-short" aria-hidden="true" />
            </span>
            <span className="ui-skeleton-bar ui-search-skel-end" aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A search with no lines (FLOW-368 §2.6): the name searched, one muted line, and with chips a text link to drop them. */
export function SearchEmptyState({ text, withChips, onClearChips }: { text: string; withChips: boolean; onClearChips: () => void }) {
  return (
    <div className="ui-search-empty">
      <h2 className="ui-search-empty-title">{text !== "" ? `לא מצאנו ״${text}״` : "אין תנועות שמתאימות לסינון"}</h2>
      <p className="ui-search-empty-body">
        {withChips
          ? "החיפוש הוא לפי ספק, לקוח, פרויקט, קטגוריה או סכום, בתוך הסינון שבחרתם."
          : "החיפוש הוא לפי ספק, לקוח, פרויקט, קטגוריה או סכום."}
      </p>
      {withChips ? (
        <Button variant="link" onClick={onClearChips}>חיפוש בלי הסינון</Button>
      ) : null}
    </div>
  );
}

/**
 * FLOW-163 (board ReportEntrySearch): the reports the typed text names, under "דוחות", first in the
 * results. Each row is the project shortcut's row with the document icon in its tile, and opens that
 * report.
 */
export function SearchReportShortcuts({ rows }: { rows: readonly ReportShortcut[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="ui-search-section ui-search-reports" aria-labelledby="ui-search-reports-title">
      <h2 className="ui-search-heading" id="ui-search-reports-title">דוחות</h2>
      <ul className="ui-search-reports-list">
        {rows.map((row) => (
          <li key={row.key}>
            <Link className="ui-search-project" to={row.to}>
              <span className="ui-search-project-tile" aria-hidden="true"><DocumentIcon size={20} /></span>
              <span className="ui-search-project-text">
                <span className="ui-search-project-name">{row.title}</span>
                <span className="ui-search-project-hint">{row.hint}</span>
              </span>
              <span className="ui-search-project-chevron" aria-hidden="true">
                <BackIcon size={18} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
