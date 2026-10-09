import type { MissingBill } from "@flow/shared";
import { missingBillViews, useMissingBillsQuery } from "../forecast";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { MissingBillList } from "../ui/missing-bill-list";
import { ScreenHeader } from "../ui/screen-header";

/**
 * FLOW-403, plan option A2: "לא הגיעו", the recurring suppliers whose bill for this month is late
 * (`missing_bills`). Opened from Home's pending card. Read only, for viewers too.
 */
export function MissingBillsScreen({ sample }: { sample?: MissingBill[] } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const query = useMissingBillsQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, query);
  const rows = missingBillViews(sample ?? query.data ?? [], search);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="לא הגיעו" backTo={`/${search}`} />
      <MissingBillList rows={rows} phase={phase} onRetry={() => { void query.refetch(); }} />
    </div>
  );
}
