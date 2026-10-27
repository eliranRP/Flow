import { type FiledTodayRow } from "@flow/shared";
import { useLocation, useSearchParams } from "react-router-dom";
import { loanRowProps, useLoanMarks } from "./loan-marks";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useFiledTodayQuery } from "../use-books";
import { FILED_TODAY_EMPTY_BODY, FILED_TODAY_EMPTY_TITLE } from "../filed-today-copy";
import { useHeldOrder } from "../list-hold";
import { txnListState } from "../txn-nav";
import { PageLoadFailed } from "../ui/band-states";
import { ListRow } from "../ui/list-row";
import { GroupList } from "../ui/month-list";
import { groupByKey } from "../ui/month-groups";
import { lineCountHint } from "../line-count-hint";
import { KeptOutTag, rowSource } from "../ui/line-marks";
import { KEPT_OUT } from "./screen-shared";
import { ScreenState } from "../ui/screen-state";
import { DEV_FILED_ROWS } from "../dev/filed-today-sample";
import { ListTake, ReviewListEmpty, signedTotals } from "./review-lists";

function devFiledFixture(sampleFlag: string | null): FiledTodayRow[] | undefined {
  if (!import.meta.env.DEV || sampleFlag !== "1") return undefined;
  return [...DEV_FILED_ROWS];
}

/** No project is its own group, named as the breakdown names it. */
export const FILED_NO_PROJECT = "בלי פרויקט";

function filedGroup(row: FiledTodayRow): { key: string; title: string } {
  const name = row.project_name?.trim() ?? "";
  return name === "" ? { key: "", title: FILED_NO_PROJECT } : { key: `p:${name}`, title: name };
}

/** The list has no currency: its rows show shekels, so the head adds them as shekels. */
function filedAmount(row: FiledTodayRow) {
  return { minor: row.amount_net, currency: "ILS", direction: row.direction };
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
  const held = useHeldOrder(shown ?? filed.data ?? [], (row) => row.id);
  // FLOW-334: under one head per project, with its count and total; the row keeps only the category.
  const groups = groupByKey(held, filedGroup, filedAmount, true);
  const rows = groups.flatMap((group) => group.rows);
  const location = useLocation();
  const rowIds = rows.map((row) => row.id);
  const filedMarks = useLoanMarks(rows.map((row) => row.id), shown == null);
  // FLOW-971: the day's total, signed, one figure per currency; a line kept out of profit adds nothing.
  const totals = signedTotals(rows, (row) => {
    if (row.kept_out === true) return null;
    const abs = row.amount_net < 0n ? -row.amount_net : row.amount_net;
    return { minor: row.direction === "income" ? abs : -abs, currency: row.currency ?? "ILS" };
  });
  return (
    <ScreenState
      title="שויכו היום"
      kicker="לאישור"
      subtitle={rows.length === 1 ? "שורה אחת שויכה היום · אפשר לשנות אותה" : `${String(rows.length)} שורות שויכו היום · אפשר לשנות כל אחת`}
      backTo={backTo ?? `/review${search}`}
      phase={phase.kind === "ready" && rows.length === 0 ? { kind: "empty" } : phase}
      onRetry={() => { void filed.refetch(); }}
      empty={(
        <div className="ui-review-list-body">
          <ReviewListEmpty title={FILED_TODAY_EMPTY_TITLE} body={FILED_TODAY_EMPTY_BODY} action="ללאישור" to={backTo ?? `/review${search}`} />
        </div>
      )}
      failed={(retry, offline) => (
        <div className="ui-review-list-body">
          <PageLoadFailed title="השיוכים של היום לא נטענו" offline={offline} onRetry={retry} />
        </div>
      )}
    >
      <div className="ui-review-list-body">
        <ListTake figures={totals} />
      </div>
      <GroupList
        groups={groups}
        keyOf={(row) => row.id}
        dateOf={(row) => row.doc_date}
        countOf={(count) => lineCountHint(count, false)}
        cents
        renderRow={(row) => (
          <ListRow
            variant="transaction"
            title={row.supplier_name ?? row.description}
            {...loanRowProps(filedMarks.get(row.id), row.category_name ?? "")}
            agorot={row.amount_net}
            currency={row.currency}
            sign={row.direction === "income" ? "in" : "out"}
            source={rowSource(row.source)}
            tag={row.kept_out === true ? <KeptOutTag label={KEPT_OUT} /> : undefined}
              setAside={row.kept_out === true}
            href={rowHref ? rowHref(row) : `/transactions/${row.id}${search}`}
            state={rowHref ? undefined : txnListState(rowIds, row.id, `${location.pathname}${location.search}`)}
          />
        )}
      />
    </ScreenState>
  );
}
