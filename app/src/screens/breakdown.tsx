import type { Breakdown, BreakdownDirection, BreakdownGroupBy, BreakdownLinesPage } from "@flow/shared";
import { useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import {
  currencyFirst,
  directionLabel,
  excludedLinesPath,
  groupByOptions,
  groupLinesPath,
  groupTitle,
  isDirection,
  isGroupBy,
  lineCountHint,
  lineHint,
  readGroupBy,
  writeGroupBy,
} from "../breakdown";
import { useHeldOrder } from "../list-hold";
import { allTime, customRange, lastMonth, periodHint, periodLabel, samePeriod, thisMonth, yearToDate } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useBooks, useBreakdownLinesQuery, useBreakdownQuery } from "../use-books";
import { BigNumber } from "../ui/big-number";
import { Button } from "../ui/button";
import { formatDayMonth } from "../ui/date-math";
import { EmptyState } from "../ui/empty-state";
import { ChartIcon, DocumentIcon, ReviewIcon } from "../ui/icons";
import { SectionHead } from "../ui/layout";
import { List, ListRow } from "../ui/list-row";
import { PeriodPicker, RangeSheet } from "../ui/period-picker";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";

/** FLOW-301. Home's נכנס or יצא by group, then one group's lines. Decision 0110, option A. */

type Sum = { currency: string; amount_minor: bigint };

/** Signed for display: an expense shows a minus, a net refund does not. */
function shown(direction: BreakdownDirection, amount: bigint): bigint {
  return direction === "expense" ? -amount : amount;
}

function Totals({ direction, totals }: { direction: BreakdownDirection; totals: Sum[] }) {
  if (totals.length === 0) return null;
  return (
    <p className="ui-breakdown-total ui-page-pad">
      {totals.map((total) => (
        <span key={total.currency} className="ui-breakdown-total-line">
          <BigNumber agorot={shown(direction, total.amount_minor)} currency={total.currency} size="display" />
        </span>
      ))}
    </p>
  );
}

function PeriodControl({ sheet, setSheet }: { sheet: boolean; setSheet: (open: boolean) => void }) {
  const books = useBooks();
  const [range, setRange] = useState(false);
  const choices = [thisMonth(), lastMonth(), yearToDate(), allTime()];
  return (
    <>
      <PeriodPicker
        tone="page"
        pill={periodLabel(books.period)}
        open={sheet}
        onOpenChange={setSheet}
        onCustom={() => {
          setRange(true);
        }}
        options={choices.map((choice) => ({
          label: periodLabel(choice),
          hint: periodHint(choice),
          selected: samePeriod(choice, books.period),
          onSelect: () => {
            books.setPeriod(choice);
          },
        }))}
      />
      <RangeSheet
        open={range}
        onOpenChange={setRange}
        onApply={(from, to) => {
          books.setPeriod(customRange(from, to));
        }}
      />
    </>
  );
}

export function BreakdownScreen({ sample, sampleGroupBy }: { sample?: Breakdown; sampleGroupBy?: BreakdownGroupBy } = {}) {
  const { direction } = useParams();
  const search = usePreviewSearch();
  if (!isDirection(direction)) return <Navigate to={`/${search}`} replace />;
  return <BreakdownBody direction={direction} sample={sample} sampleGroupBy={sampleGroupBy} search={search} />;
}

function BreakdownBody({
  direction,
  sample,
  sampleGroupBy,
  search,
}: {
  direction: BreakdownDirection;
  sample?: Breakdown;
  sampleGroupBy?: BreakdownGroupBy;
  search: string;
}) {
  const preview = useHomePreview();
  const books = useBooks();
  const [groupBy, setGroupBy] = useState<BreakdownGroupBy>(() => sampleGroupBy ?? readGroupBy());
  const query = useBreakdownQuery(direction, groupBy, sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, query);
  const data = sample ?? (phase.kind === "ready" ? query.data ?? null : null);
  const groups = useHeldOrder(data?.groups ?? [], (group) => `${group.currency}:${group.key}`);
  const [sheet, setSheet] = useState(false);
  const title = directionLabel(direction);
  const back = `/${search}`;
  const period = <PeriodControl sheet={sheet} setSheet={setSheet} />;

  if (phase.kind === "loading" || phase.kind === "error") {
    return <ScreenState stacked title={title} backTo={back} trailing={period} phase={phase} onRetry={() => { void query.refetch(); }} />;
  }

  const empty = data == null || (data.totals.length === 0 && data.groups.length === 0 && data.excluded.length === 0);
  const excluded = [...(data?.excluded ?? [])].sort((a, b) => currencyFirst(a.currency, b.currency));
  const review = data?.review_count ?? 0;
  const count = (data?.totals ?? []).reduce((sum, total) => sum + total.count, 0);

  return (
    <div>
      <ScreenHeader layout="stacked" title={title} backTo={back} trailing={period} />
      <Totals direction={direction} totals={data?.totals ?? []} />
      {count > 0 ? <p className="ui-breakdown-hint ui-page-pad t-hint">{lineCountHint(count, false)} · {periodLabel(books.period)}</p> : null}
      {empty ? (
        <EmptyState
          icon={<ChartIcon />}
          title={direction === "income" ? "אין הכנסות בתקופה הזו" : "אין הוצאות בתקופה הזו"}
          body="אפשר לבחור תקופה אחרת."
          action={
            <Button
              variant="pill"
              onClick={() => {
                setSheet(true);
              }}
            >
              בחירת תקופה
            </Button>
          }
        />
      ) : (
        <>
          <div className="ui-page-pad">
            <SegmentedControl
              label="לפי"
              showLabel={false}
              value={groupBy}
              options={groupByOptions(direction)}
              onChange={(next) => {
                setGroupBy(next);
                writeGroupBy(next);
              }}
            />
          </div>
          <List>
            {groups.map((group) => (
              <ListRow
                key={`${group.currency}:${group.key}`}
                variant="project"
                title={groupTitle(direction, groupBy, group.key, group.name)}
                hint={lineCountHint(group.count, group.shared)}
                agorot={shown(direction, group.amount_minor)}
                currency={group.currency}
                loss={false}
                chevron
                href={groupLinesPath(direction, groupBy, group.currency, group.key, search)}
              />
            ))}
          </List>
          {review > 0 ? (
            <List className="ui-breakdown-quiet">
              <ListRow
                variant="item"
                tone="muted"
                icon={<ReviewIcon />}
                title={`${String(review)} ממתינים לאישור`}
                hint="כבר כלולים בסכום"
                chevron
                href={`/review${search}`}
              />
            </List>
          ) : null}
          {excluded.length > 0 ? (
            <>
              <SectionHead title="לא נכלל בסכום" />
              <List className="ui-breakdown-quiet">
                {excluded.map((sum) => (
                  <ListRow
                    key={sum.currency}
                    variant="project"
                    title="מחוץ לרווח"
                    hint={lineCountHint(sum.count, false)}
                    agorot={shown(direction, sum.amount_minor)}
                    currency={sum.currency}
                    loss={false}
                    chevron
                    href={excludedLinesPath(direction, sum.currency, search)}
                  />
                ))}
              </List>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

type LinesSample = { breakdown: Breakdown; pages: BreakdownLinesPage[] };

export function BreakdownLinesScreen({ excluded = false, sample }: { excluded?: boolean; sample?: LinesSample } = {}) {
  const { direction, groupBy, currency = "ILS", groupKey = "" } = useParams();
  const search = usePreviewSearch();
  const by = excluded ? "category" : groupBy;
  if (!isDirection(direction) || !isGroupBy(by) || !/^[A-Z]{3}$/.test(currency)) {
    return <Navigate to={`/${search}`} replace />;
  }
  return (
    <LinesBody
      direction={direction}
      groupBy={by}
      currency={currency}
      groupKey={excluded ? "" : groupKey}
      excluded={excluded}
      search={search}
      sample={sample}
    />
  );
}

function LinesBody({
  direction,
  groupBy,
  currency,
  groupKey,
  excluded,
  search,
  sample,
}: {
  direction: BreakdownDirection;
  groupBy: BreakdownGroupBy;
  currency: string;
  groupKey: string;
  excluded: boolean;
  search: string;
  sample?: LinesSample;
}) {
  const preview = useHomePreview();
  const { period } = useBooks();
  const summary = useBreakdownQuery(direction, groupBy, sample == null);
  const lines = useBreakdownLinesQuery(direction, groupBy, groupKey, currency, excluded, sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, lines);
  const pages = sample?.pages ?? lines.data?.pages ?? [];
  const loaded = pages.flatMap((page) => page?.rows ?? []);
  const rows = useHeldOrder(loaded, (row) => `${row.transaction_id}:${row.part ?? ""}`);
  const breakdown = sample?.breakdown ?? summary.data ?? null;
  const group = excluded ? undefined : breakdown?.groups.find((g) => g.key === groupKey && g.currency === currency);
  const sum = excluded ? breakdown?.excluded.find((e) => e.currency === currency) : group;
  const title = excluded ? "מחוץ לרווח" : groupTitle(direction, groupBy, groupKey, group?.name);
  const back = `/flow/${direction}${search}`;

  if (phase.kind === "loading" || phase.kind === "error") {
    return <ScreenState stacked title={title} backTo={back} phase={phase} onRetry={() => { void lines.refetch(); }} />;
  }

  const subtitleParts: string[] = [directionLabel(direction), periodLabel(period)];
  if (sum) subtitleParts.push(lineCountHint(sum.count, false));
  const more = sample ? false : lines.hasNextPage;

  return (
    <div>
      <ScreenHeader layout="stacked" title={title} subtitle={subtitleParts.join(" · ")} backTo={back} />
      {sum ? <Totals direction={direction} totals={[sum]} /> : null}
      {rows.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין תנועות כאן בתקופה הזו" body="אפשר לחזור ולבחור תקופה אחרת." />
      ) : (
        <List>
          {rows.map((row) => {
            const outgoing = (direction === "expense") === (row.amount_minor >= 0n);
            const hint = [lineHint(groupBy, row), formatDayMonth(row.doc_date), row.shared ? "חלק משותף" : null]
              .filter((part): part is string => part != null && part !== "")
              .join(" · ");
            return (
              <ListRow
                key={`${row.transaction_id}:${row.part ?? ""}`}
                variant="transaction"
                title={groupBy === "payer" && !excluded ? row.description : row.supplier_name ?? row.description}
                hint={hint}
                agorot={row.amount_minor}
                currency={row.currency}
                sign={outgoing ? "out" : "in"}
                source="invoice"
                href={`/transactions/${row.transaction_id}${search}`}
              />
            );
          })}
        </List>
      )}
      {more ? (
        <div className="ui-page-pad">
          <Button
            variant="pill"
            busy={lines.isFetchingNextPage}
            onClick={() => {
              void lines.fetchNextPage();
            }}
          >
            עוד תנועות
          </Button>
        </div>
      ) : null}
    </div>
  );
}
