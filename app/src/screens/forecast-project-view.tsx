import type { ForecastItem } from "@flow/shared";
import { Amount } from "../ui/amount";
import type { ForecastProjectGroup } from "../forecast-projects";
import { ForecastRowButton } from "./forecast-parts";

/**
 * לפי פרויקט (FLOW-1004): one section per project, as the company's צפי page lists them, the general costs
 * (כללי) last. Each is headed by its name and its net still to come, then its items, money in first; a tap
 * opens an item's page, as לפי פריט.
 */
export function ForecastProjectView({
  groups,
  currency,
  today,
  onOpenItem,
  leavingKey,
}: {
  groups: readonly ForecastProjectGroup[];
  currency: string;
  today: string;
  onOpenItem: (item: ForecastItem) => void;
  leavingKey: string | null;
}) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.projectId ?? `general:${group.name}`} className="ui-forecast-section" aria-label={group.name}>
          <h2 className="ui-forecast-section-head">
            <span>{group.name}</span>
            <span className="ui-forecast-section-total">
              <Amount agorot={group.net} size="list" currency={currency} income={group.net > 0n} />
            </span>
          </h2>
          <ul className="ui-forecast-list">
            {[...group.income, ...group.expense].map((item) => (
              <ForecastRowButton key={item.key} item={item} today={today} onOpen={onOpenItem} leaving={leavingKey === item.key} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
