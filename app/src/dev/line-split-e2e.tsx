import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { LineSplitScreen } from "../screens/line-split";
import { BOARD_SPLIT_CATEGORIES, BOARD_SPLIT_LINE, BOARD_SPLIT_PROJECTS, SAMPLE_EXPENSE_LINE, SAMPLE_REFUND_LINE, SAMPLE_SPLIT_CATEGORIES, SAMPLE_SPLIT_PROJECTS, sampleSplitApi } from "./line-split-sample";

/**
 * FLOW-325. The parts editor on a sample line for Playwright, with the sample preview and a
 * save that keeps what it was sent in sessionStorage under e2e-line-split-saved, which outlives
 * the screen closing. Dev builds only.
 * `?line=refund` opens the inflow; `?save=fail` refuses every save as a dropped connection.
 * `?board=1` opens the split board's sample (FLOW-370 proof fixture).
 */
export function DevLineSplit() {
  const [params] = useSearchParams();
  const refund = params.get("line") === "refund";
  const fail = params.get("save") === "fail";
  const board = params.get("board") === "1";
  const line = board ? BOARD_SPLIT_LINE : refund ? SAMPLE_REFUND_LINE : SAMPLE_EXPENSE_LINE;
  const api = useMemo(() => sampleSplitApi(line, (parts) => {
    if (fail) throw new Error("Failed to fetch");
    sessionStorage.setItem("e2e-line-split-saved", JSON.stringify(parts));
  }), [line, fail]);
  return (
    <LineSplitScreen
      backTo="/e2e/split-category/done"
      sample={{
        line,
        categories: board ? BOARD_SPLIT_CATEGORIES : SAMPLE_SPLIT_CATEGORIES,
        projects: board ? BOARD_SPLIT_PROJECTS : SAMPLE_SPLIT_PROJECTS,
        api,
      }}
    />
  );
}
