import { useId } from "react";
import { ChevronDownIcon, PlusIcon, SplitIcon, TagIcon } from "./icons";
import { RadioRow } from "./radio-row";
import { SearchField } from "./search-field";
import { Skeleton } from "./skeleton";
import { TextLink } from "./text-link";
import type { ChangeChoice } from "./change-sheet-copy";

const skeletonKeys = ["a", "b", "c", "d", "e"] as const;

/** The rest's heading under the project groups (FLOW-406, picker). */
export const PICK_REST_HEADING = "שאר הפרויקטים";

/**
 * FLOW-406 (picker): with any grouped project, each group's projects under its name, in the order
 * its first project is listed, then שאר הפרויקטים. Groups are told apart by id, so two groups that
 * share a name stay apart. `pinnedId` (the suggestion) stays out of the sections: it is listed
 * above them, first, as in the flat list. Null when no project has a group.
 */
export function groupSections(
  listed: readonly ChangeChoice[],
  pinnedId?: string,
): { heading: string; index: number; options: ChangeChoice[] }[] | null {
  if (!listed.some((option) => option.group != null && option.group !== "")) return null;
  const byGroup = new Map<string, { heading: string; options: ChangeChoice[] }>();
  const rest: ChangeChoice[] = [];
  for (const option of listed) {
    if (pinnedId != null && option.id === pinnedId) continue;
    if (option.group == null || option.group === "") {
      rest.push(option);
      continue;
    }
    const key = option.groupId ?? option.group;
    const section = byGroup.get(key) ?? { heading: option.group, options: [] };
    section.options.push(option);
    byGroup.set(key, section);
  }
  const sections = [...byGroup.values()];
  if (rest.length > 0) sections.push({ heading: PICK_REST_HEADING, options: rest });
  return sections.map((section, index) => ({ ...section, index }));
}

/**
 * FLOW-358: a search that found a project only through its group's name shows that name under
 * the row, so a visible row holds what was typed.
 */
export function groupHint(option: ChangeChoice, needle: string): string | undefined {
  if (needle === "" || option.group == null || !option.group.includes(needle)) return undefined;
  if (option.name.includes(needle) || (option.code ?? "").toLowerCase().includes(needle.toLowerCase())) return undefined;
  return option.group;
}

export function Picker({
  kind,
  searchable,
  query,
  onQuery,
  loading,
  listed,
  selectedId,
  suggestionId,
  suggestionJev = false,
  savingId,
  note,
  noneLabel,
  reversal,
  splitLink = true,
  onSelect,
  onCreate,
  onSplit,
  splitCategory,
}: {
  kind: "project" | "category";
  searchable: boolean;
  query: string;
  onQuery: (value: string) => void;
  loading: boolean;
  listed: ChangeChoice[];
  selectedId: string;
  suggestionId: string;
  /** The suggestion is Jev's fill: its row says הצעת Jev (FLOW-704). */
  suggestionJev?: boolean;
  savingId: string | null;
  note?: string;
  /** A first row with id "", such as "בלי פרויקט". Hidden while searching. */
  noneLabel?: string;
  /** The other kind's section. Shown only when it has categories. */
  reversal?: {
    heading: string;
    hint: string;
    listed: ChangeChoice[];
    open: boolean;
    onToggle: () => void;
  };
  splitLink?: boolean;
  onSelect: (id: string) => void;
  onCreate?: () => void;
  onSplit?: () => void;
  /**
   * FLOW-325 §10 (option A): "פיצול לפי קטגוריות" under the project split. Pressing it approves
   * the line and opens the parts editor. Omitted for a viewer and where the line cannot be split.
   */
  splitCategory?: { busy: boolean; onPress: () => void };
}) {
  const needle = query.trim();
  const sectionId = useId();
  const reversalListed = reversal?.listed ?? [];
  const empty = !loading && needle !== "" && listed.length === 0 && reversalListed.length === 0;
  // A checked reversal, or a search that finds one, keeps the section open so the match can be seen and reached.
  const reversalForced = reversalListed.some((option) => option.id === selectedId) || (needle !== "" && reversalListed.length > 0);
  const reversalShown = reversal != null && (reversal.open || reversalForced);
  const reversalVisible = reversal != null && (needle === "" || reversalListed.length > 0);
  const sections = kind === "project" && needle === "" ? groupSections(listed, suggestionId) : null;
  const pinned = sections != null ? listed.find((option) => option.id === suggestionId) : undefined;
  function row(option: ChangeChoice) {
    return (
      <RadioRow
        key={option.id}
        layout="picker"
        label={option.name}
        code={option.code}
        date={needle === "" ? option.recent : undefined}
        tag={option.id === suggestionId ? (suggestionJev ? "jev" : true) : false}
        description={groupHint(option, needle)}
        selected={option.id === selectedId}
        busy={option.id === savingId}
        disabled={savingId != null && option.id !== savingId}
        onSelect={() => {
          onSelect(option.id);
        }}
      />
    );
  }
  return (
    <div className="ui-change-picker">
      {searchable ? (
        <SearchField
          label={kind === "project" ? "חיפוש פרויקט" : "חיפוש קטגוריה"}
          value={query}
          onChange={onQuery}
          placeholder={kind === "project" ? "חיפוש פרויקט או קוד (P-12)" : "חיפוש קטגוריה"}
          autoFocus={false}
        />
      ) : null}
      {note ? <p className="t-hint ui-pick-note">{note}</p> : null}
      {loading ? (
        <div aria-busy="true">
          <p className="sr-only" role="status">טוען…</p>
          {skeletonKeys.map((key) => (
            <div className="ui-radio-row" key={key} aria-hidden="true">
              <Skeleton width="md" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {sections != null ? (
            <div role="radiogroup" aria-label="פרויקט">
              {noneLabel != null ? (
                <RadioRow
                  key="none"
                  layout="picker"
                  label={noneLabel}
                  selected={selectedId === ""}
                  busy={savingId === ""}
                  disabled={savingId != null && savingId !== ""}
                  onSelect={() => {
                    onSelect("");
                  }}
                />
              ) : null}
              {pinned != null ? row(pinned) : null}
              {sections.map((section) => (
                <div key={section.index} className="ui-pick-group" role="group" aria-labelledby={`${sectionId}-${String(section.index)}`}>
                  <p className="t-label ui-pick-group-head" id={`${sectionId}-${String(section.index)}`}>{section.heading}</p>
                  {section.options.map(row)}
                </div>
              ))}
            </div>
          ) : listed.length > 0 || (noneLabel != null && needle === "") ? (
            <div role="radiogroup" aria-label={kind === "project" ? "פרויקט" : "קטגוריה"}>
              {noneLabel != null && needle === "" ? (
                <RadioRow
                  key="none"
                  layout="picker"
                  label={noneLabel}
                  selected={selectedId === ""}
                  busy={savingId === ""}
                  disabled={savingId != null && savingId !== ""}
                  onSelect={() => {
                    onSelect("");
                  }}
                />
              ) : null}
              {listed.map(row)}
            </div>
          ) : null}
          {reversal && reversalVisible ? (
            <div className="ui-reversal">
              {reversalForced ? (
                <p className="t-label ui-reversal-head">{reversal.heading}</p>
              ) : (
                <TextLink
                  chevron={false}
                  expanded={reversalShown}
                  controls={sectionId}
                  trailing={<ChevronDownIcon size={16} />}
                  onClick={reversal.onToggle}
                >
                  {reversal.heading}
                </TextLink>
              )}
              <div id={sectionId} hidden={!reversalShown}>
                {reversalShown ? (
                  <>
                    <p className="t-hint ui-reversal-hint" id={`${sectionId}-hint`}>{reversal.hint}</p>
                    <div role="radiogroup" aria-label={reversal.heading} aria-describedby={`${sectionId}-hint`}>
                      {reversalListed.map(row)}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {empty ? <p className="t-hint">{kind === "project" ? "לא נמצא פרויקט בשם הזה" : "לא נמצאה קטגוריה בשם הזה"}</p> : null}
        </>
      )}
      {kind === "project" && !loading ? (
        <div className="ui-change-links">
          <TextLink icon={<PlusIcon size={16} />} chevron={false} disabled={splitCategory?.busy === true} onClick={onCreate}>פרויקט חדש</TextLink>
          {splitLink && onSplit ? <TextLink icon={<SplitIcon size={16} />} chevron={false} disabled={splitCategory?.busy === true} onClick={onSplit}>פיצול בין פרויקטים</TextLink> : null}
          {splitCategory ? (
            <TextLink
              icon={<TagIcon size={16} />}
              chevron={false}
              busy={splitCategory.busy}
              disabled={savingId != null && !splitCategory.busy}
              onClick={splitCategory.onPress}
            >
              פיצול לפי קטגוריות
            </TextLink>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
