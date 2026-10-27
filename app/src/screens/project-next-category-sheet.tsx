import type { RefObject } from "react";
import type { CategoryChoice } from "../project-next-edit";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { SearchField } from "../ui/search-field";
import { Sheet } from "../ui/sheet";

/**
 * The ProfitNextSearch and ProfitNextNoMatch sheet: a category for a forecast line. A search field, then
 * "מוצעות לפרויקט" (what the project used, with a hint) and "כל הקטגוריות" ("תוצאות" while searching).
 * With no match, "+ יצירת קטגוריה" makes the category and picks it.
 */
export function ForecastCategorySheet({
  open,
  onOpenChange,
  detail,
  query,
  onQuery,
  choices,
  selected,
  onPick,
  onCreate,
  creating,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "בצפי של Juniper Ct • נובמבר" */
  detail: string;
  query: string;
  onQuery: (query: string) => void;
  choices: { suggested: CategoryChoice[]; rest: CategoryChoice[] };
  selected: string | null;
  onPick: (choice: CategoryChoice) => void;
  onCreate: (name: string) => void;
  creating: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const setOpen = useSheetHistory("pn-category", open, onOpenChange);
  const name = query.trim();
  const none = choices.suggested.length === 0 && choices.rest.length === 0;
  // The board's compact radio row: the ring at the start, the name over its hint.
  const row = (choice: CategoryChoice) => (
    <button
      type="button"
      role="radio"
      key={choice.id}
      aria-checked={choice.id === selected}
      className="ui-fe-choice ui-hit m-press"
      onClick={() => { onPick(choice); }}
    >
      <span className="ui-fe-ring" aria-hidden="true"><span className="ui-fe-dot" /></span>
      <span className="ui-fe-choice-text">
        <span className="ui-fe-choice-name">{choice.name}</span>
        <span className="ui-fe-choice-hint">{choice.hint}</span>
      </span>
    </button>
  );
  return (
    <Sheet open={open} onOpenChange={setOpen} title="קטגוריה" subtitle={detail} returnFocusRef={returnFocusRef} panelClassName="ui-sheet-g14" busy={creating}>
      <div className="ui-fe-search">
        <SearchField label="חיפוש קטגוריה" placeholder="חיפוש קטגוריה" value={query} onChange={onQuery} />
      </div>
      <div role="radiogroup" aria-label="קטגוריה" className="ui-fe-choices">
        {choices.suggested.length === 0 ? null : (
          <>
            <p className="ui-fe-choices-title">מוצעות לפרויקט</p>
            {choices.suggested.map(row)}
          </>
        )}
        {choices.rest.length === 0 ? null : (
          <>
            <p className="ui-fe-choices-title">{name === "" ? "כל הקטגוריות" : "תוצאות"}</p>
            {choices.rest.map(row)}
          </>
        )}
        {none && name !== "" ? (
          <div className="ui-fe-no-match">
            <p className="ui-fe-no-match-text">{`אין קטגוריה בשם "${name}"`}</p>
            <Button variant="link" busy={creating} onClick={() => { onCreate(name); }}>{`+ יצירת קטגוריה "${name}"`}</Button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
