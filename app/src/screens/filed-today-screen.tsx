import { type FiledTodayRow } from "@flow/shared";
import { useLocation, useSearchParams } from "react-router-dom";
import { loanRowProps, useLoanMarks } from "./loan-marks";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useFiledTodayQuery } from "../use-books";
import { FILED_TODAY_EMPTY_BODY, FILED_TODAY_EMPTY_TITLE } from "../filed-today-copy";
import { useHeldOrder } from "../list-hold";
import { txnListState } from "../txn-nav";
import { EmptyState } from "../ui/empty-state";
import { ReviewIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { KeptOutTag, rowSource } from "../ui/line-marks";
import { KEPT_OUT } from "./screen-shared";
import { ScreenState } from "../ui/screen-state";

/** Dev-only rows so the review banner can open a list that has a transaction. */
function devFiledFixture(sampleFlag: string | null): FiledTodayRow[] | undefined {
  if (!import.meta.env.DEV || sampleFlag !== "1") return undefined;
  return [{
    id: "t-filed",
    description: "מלט",
    doc_date: "2026-09-29",
    amount_net: -350_000n,
    direction: "expense",
    supplier_name: "מנופי המרכז בע״מ",
    project_name: "שיפוץ הרצל 12",
    category_name: "חומרים",
  }];
}

export function FiledTodayScreen({
  sample,
  backTo,
  rowHref,
}: {
  sample?: FiledTodayRow[];
  /** Overrides the queue as the parent. The reviewer preview uses its own index. */
  backTo?: string;
  /** Overrides the transaction route. The reviewer preview stays on sample screens. */
  rowHref?: (row: FiledTodayRow) => string;
} = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const [params] = useSearchParams();
  const fixture = devFiledFixture(params.get("sample"));
  const shown = sample ?? fixture;
  const filed = useFiledTodayQuery(shown == null);
  const phase = shown ? ({ kind: "ready" } as const) : screenPhase(preview, filed);
  const rows = useHeldOrder(shown ?? filed.data ?? [], (row) => row.id);
  const location = useLocation();
  const rowIds = rows.map((row) => row.id);
  const filedMarks = useLoanMarks(rows.map((row) => row.id), shown == null);
  return (
    <ScreenState
      title="שויכו היום"
      backTo={backTo ?? `/review${search}`}
      phase={phase.kind === "ready" && rows.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void filed.refetch(); }}
      empty={<EmptyState icon={<ReviewIcon />} title={FILED_TODAY_EMPTY_TITLE} body={FILED_TODAY_EMPTY_BODY} />}
    >
      <List>
        {rows.map((row) => (
          <ListRow
            key={row.id}
            variant="transaction"
            title={row.supplier_name ?? row.description}
            {...loanRowProps(filedMarks.get(row.id), [row.project_name, row.category_name].filter((part) => part != null && part !== "").join(" · "))}
            agorot={row.amount_net}
            sign={row.direction === "income" ? "in" : "out"}
            source={rowSource(row.source)}
            tag={row.kept_out === true ? <KeptOutTag label={KEPT_OUT} /> : undefined}
            href={rowHref ? rowHref(row) : `/transactions/${row.id}${search}`}
            state={rowHref ? undefined : txnListState(rowIds, row.id, `${location.pathname}${location.search}`)}
          />
        ))}
      </List>
    </ScreenState>
  );
}
