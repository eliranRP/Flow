import { BackIcon, SearchIcon } from "../ui/icons";

export type QuickCheck = {
  key: string;
  title: string;
  hint: string;
  /** Null while the count is still loading. */
  count: number | null;
  onPick: () => void;
};

/**
 * What the search shows before anything is typed (FLOW-368 §2.2): the last searches, which fill
 * the field, and three ready searches with a live count.
 */
export function SearchStart({
  recent,
  checks,
  onRecent,
}: {
  recent: readonly string[];
  checks: readonly QuickCheck[];
  onRecent: (text: string) => void;
}) {
  return (
    <div className="ui-search-start">
      {recent.length > 0 ? (
        <section className="ui-search-section" aria-labelledby="ui-search-recent-title">
          <h2 className="ui-search-heading" id="ui-search-recent-title">חיפושים אחרונים</h2>
          <ul className="ui-search-recent">
            {recent.map((text) => (
              <li key={text}>
                <button type="button" className="ui-search-recent-row" onClick={() => { onRecent(text); }}>
                  <span className="ui-search-recent-icon" aria-hidden="true">
                    <SearchIcon size={20} stroke={1.6} />
                  </span>
                  <span className="ui-search-recent-text">{text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="ui-search-section" aria-labelledby="ui-search-checks-title">
        <h2 className="ui-search-heading" id="ui-search-checks-title">שווה לבדוק</h2>
        <ul className="ui-search-checks">
          {checks.map((check) => (
            <li key={check.key}>
              <button type="button" className="ui-search-check" onClick={check.onPick}>
                <span className="ui-search-check-text">
                  <span className="ui-search-check-title">{check.title}</span>
                  <span className="ui-search-check-hint">{check.hint}</span>
                </span>
                <span className="ui-search-check-count">{check.count ?? ""}</span>
                <span className="ui-search-check-chevron" aria-hidden="true">
                  <BackIcon size={18} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
