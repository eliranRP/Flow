import type { ExpectedMonths as ExpectedMonthsData } from "@flow/shared";
import { useRef, useState } from "react";
import { useCompanyCurrency } from "../company-currency";
import { expectedMonthViews, hasExpectedHistory, useExpectedMonthsQuery } from "../forecast";
import { useHomePreview } from "../preview";
import { screenPhase } from "../query-phase";
import { ExpectedMonthSheet } from "../ui/expected-month-sheet";
import { ExpectedMonths, type ExpectedMonthRow } from "../ui/expected-months";

/**
 * FLOW-403 (plan option A3 and A4). The project page's "צפוי" block: three months of expected
 * expenses from `expected_months`, and the sheet of who makes up a month. Self-contained, so the
 * project page mounts it with one line under the categories. Read only, for viewers too.
 *
 * `live` is false on a sample project (dev routes, Storybook): it then draws `sample`, or nothing.
 */
export function ProjectExpectedMonths({
  projectId,
  live,
  sample,
}: {
  projectId: string;
  live: boolean;
  sample?: ExpectedMonthsData;
}) {
  const preview = useHomePreview();
  const companyCurrency = useCompanyCurrency();
  const query = useExpectedMonthsQuery(live ? projectId : "");
  const [selected, setSelected] = useState<ExpectedMonthRow | null>(null);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  if (!live && sample == null) return null;
  const data = live ? query.data : sample;
  const phase = live ? screenPhase(preview, query) : ({ kind: "ready" } as const);
  const months = data != null && hasExpectedHistory(data) ? expectedMonthViews(data, companyCurrency) : [];
  return (
    <>
      <ExpectedMonths
        months={months}
        phase={phase}
        onRetry={() => { void query.refetch(); }}
        onOpen={(month, button) => {
          opener.current = button;
          setSelected(month);
          setOpen(true);
        }}
      />
      <ExpectedMonthSheet month={selected} open={open} onOpenChange={setOpen} returnFocusRef={opener} />
    </>
  );
}
