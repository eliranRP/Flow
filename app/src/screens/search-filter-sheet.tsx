import { allTime, presetPeriod, type PeriodChoice } from "../period";
import { searchCountWords, type SearchDirection, type SearchFilters } from "../search";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { SegmentedControl } from "../ui/segmented-control";
import { Sheet } from "../ui/sheet";
import { Toggle } from "../ui/toggle";

export type SearchSheetProject = { id: string; name: string; status?: string };

type TypeChoice = "all" | SearchDirection;
type PeriodChoiceKey = "all" | "month" | "months3";

/** The filters the sheet edits (FLOW-368 §2.4): type, period, project and the review switch. */
export function periodKey(period: PeriodChoice): PeriodChoiceKey {
  if (period.kind === "month") return "month";
  if (period.kind === "months3") return "months3";
  return "all";
}

export function periodFor(key: PeriodChoiceKey): PeriodChoice {
  return key === "all" ? allTime() : presetPeriod(key);
}

/** The count of chips a filter set turns on: the badge on סינון. */
export function activeFilterCount(filters: SearchFilters): number {
  return [
    filters.direction != null,
    filters.period.kind !== "all",
    filters.project != null,
    filters.category != null,
    filters.review,
  ].filter(Boolean).length;
}

export function SearchFilterSheet({
  open,
  onOpenChange,
  draft,
  onDraft,
  projects,
  count,
  onClear,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: SearchFilters;
  onDraft: (patch: Partial<SearchFilters>) => void;
  projects: readonly SearchSheetProject[];
  /** The live count for the draft filters; null while it loads. */
  count: number | null;
  onClear: () => void;
  onApply: () => void;
}) {
  const shown = projects.filter((project) => project.status !== "finished");
  const applyLabel = count == null ? "הצגת תנועות" : count === 1 ? "הצגת תנועה אחת" : `הצגת ${searchCountWords(count)}`;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="סינון">
      <div className="ui-search-filter">
        <div className="ui-search-filter-group">
          <p className="ui-search-filter-label">סוג</p>
          <SegmentedControl<TypeChoice>
            label="סוג"
            showLabel={false}
            value={draft.direction ?? "all"}
            options={[
              { value: "all", label: "הכל" },
              { value: "expense", label: "הוצאות" },
              { value: "income", label: "הכנסות" },
            ]}
            onChange={(value) => { onDraft({ direction: value === "all" ? null : value }); }}
          />
        </div>
        <div className="ui-search-filter-group">
          <p className="ui-search-filter-label">תקופה</p>
          <SegmentedControl<PeriodChoiceKey>
            label="תקופה"
            showLabel={false}
            value={periodKey(draft.period)}
            options={[
              { value: "all", label: "הכל" },
              { value: "month", label: "החודש" },
              { value: "months3", label: "3 חודשים" },
            ]}
            onChange={(value) => { onDraft({ period: periodFor(value) }); }}
          />
        </div>
        <div className="ui-search-filter-group">
          <p className="ui-search-filter-label">פרויקט</p>
          <div className="ui-search-filter-projects" role="group" aria-label="פרויקט">
            <Chip pressed={draft.project == null} onClick={() => { onDraft({ project: null }); }}>כל הפרויקטים</Chip>
            {shown.map((project) => (
              <Chip
                key={project.id}
                pressed={draft.project === project.id}
                onClick={() => { onDraft({ project: project.id }); }}
              >
                {project.name}
              </Chip>
            ))}
          </div>
        </div>
        <Toggle
          label="רק ממתינים לאישור"
          checked={draft.review}
          onChange={(checked) => { onDraft({ review: checked }); }}
        />
        <div className="ui-search-filter-foot">
          <button type="button" className="ui-search-filter-clear" onClick={onClear}>ניקוי</button>
          <Button onClick={onApply}>{applyLabel}</Button>
        </div>
      </div>
    </Sheet>
  );
}
