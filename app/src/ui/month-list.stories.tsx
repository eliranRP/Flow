import type { Meta, StoryObj } from "@storybook/react";
import { ListRow } from "./list-row";
import { MonthList } from "./month-list";
import { largeAgorot } from "./story-support";

type Row = { id: string; title: string; date: string; minor: bigint; currency: string; direction: "income" | "expense" };

const ROWS: Row[] = [
  { id: "1", title: "תשלום מלקוח", date: "2026-09-14", minor: 1_200_000n, currency: "ILS", direction: "income" },
  { id: "2", title: "חומרי בניין", date: "2026-09-10", minor: 350_000n, currency: "ILS", direction: "expense" },
  { id: "3", title: "ייעוץ תכנון", date: "2026-08-28", minor: 40_000n, currency: "USD", direction: "expense" },
  { id: "4", title: "שכר דירה", date: "2026-08-20", minor: 150_000n, currency: "USD", direction: "income" },
  { id: "5", title: "אינסטלציה", date: "2026-08-12", minor: 220_000n, currency: "ILS", direction: "expense" },
  { id: "6", title: "מקדמה מלקוח", date: "2026-08-05", minor: 800_000n, currency: "ILS", direction: "income" },
  { id: "7", title: "ריצוף", date: "2026-07-25", minor: 450_000n, currency: "ILS", direction: "expense" },
];

const LARGE: Row[] = [
  { id: "1", title: "חשבונית גדולה", date: "2026-09-14", minor: largeAgorot, currency: "ILS", direction: "income" },
  { id: "2", title: "הוצאה גדולה", date: "2026-09-10", minor: largeAgorot, currency: "ILS", direction: "expense" },
  { id: "3", title: "חשבונית דולרית", date: "2026-08-28", minor: largeAgorot, currency: "USD", direction: "income" },
  { id: "4", title: "הוצאה דולרית", date: "2026-08-20", minor: largeAgorot, currency: "USD", direction: "expense" },
  { id: "5", title: "הוצאה בשקלים", date: "2026-08-12", minor: largeAgorot, currency: "ILS", direction: "expense" },
];

/** Story args name a sample set, so they stay JSON-serializable (no bigint). */
const TWO: Row[] = [
  { id: "1", title: "לקוח לדוגמה", date: "2026-09-14", minor: 1_250_050n, currency: "ILS", direction: "income" },
  { id: "2", title: "ספק לדוגמה", date: "2026-09-10", minor: 123_456n, currency: "ILS", direction: "expense" },
  { id: "3", title: "חומרי בניין", date: "2026-09-03", minor: 80_000n, currency: "ILS", direction: "expense" },
  { id: "4", title: "מקדמה מלקוח", date: "2026-08-25", minor: 500_000n, currency: "ILS", direction: "income" },
  { id: "5", title: "אינסטלציה", date: "2026-08-12", minor: 220_075n, currency: "ILS", direction: "expense" },
];

/** September has one expense in each currency, so its two currency lines fit side by side (FLOW-313). */
const MIXED: Row[] = [
  { id: "1", title: "חומרי בניין", date: "2026-09-14", minor: 35_000n, currency: "ILS", direction: "expense" },
  { id: "2", title: "מנוי תוכנה", date: "2026-09-10", minor: 4_000n, currency: "USD", direction: "expense" },
  { id: "3", title: "אינסטלציה", date: "2026-08-12", minor: 22_000n, currency: "ILS", direction: "expense" },
];

const SETS = { three: ROWS, large: LARGE, one: ROWS.slice(0, 2), two: TWO, mixed: MIXED } as const;

/** Every matching line's totals, as search's first page sends them: more lines than are loaded. */
const SERVER_TOTALS = new Map([
  ["2026-09", [{ currency: "ILS", incomeMinor: 1_200_000n, expenseMinor: 350_000n }]],
  ["2026-08", [{ currency: "ILS", incomeMinor: 800_000n, expenseMinor: 1_420_000n }, { currency: "USD", incomeMinor: 150_000n, expenseMinor: 40_000n }]],
  ["2026-07", [{ currency: "ILS", incomeMinor: 0n, expenseMinor: 1_034_267n }]],
]);

function MonthListView({
  set,
  complete = true,
  days = false,
  server = false,
}: {
  set: keyof typeof SETS;
  complete?: boolean;
  days?: boolean;
  /** Search's net heads with the server's month totals while the list is still paging. */
  server?: boolean;
}) {
  const rows: readonly Row[] = SETS[set];
  return (
    <MonthList
      rows={rows}
      keyOf={(row) => row.id}
      dateOf={(row) => row.date}
      amountOf={(row) => ({ minor: row.minor, currency: row.currency, direction: row.direction })}
      complete={complete}
      days={days}
      cents={days || server}
      net={server}
      monthTotals={server ? SERVER_TOTALS : undefined}
      renderRow={(row) => (
        <ListRow
          variant="transaction"
          title={row.title}
          hint={row.date.slice(8, 10) + "/" + row.date.slice(5, 7)}
          agorot={row.minor}
          currency={row.currency}
          sign={row.direction === "income" ? "in" : "out"}
          source="invoice"
          href={`/transactions/${row.id}`}
        />
      )}
    />
  );
}

const meta = {
  title: "Components/MonthList",
  component: MonthListView,
} satisfies Meta<typeof MonthListView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeMonths: Story = { args: { set: "three" } };
export const StillLoading: Story = { args: { set: "three", complete: false } };
/** Search: every month shows its whole net from the server, July too while its lines page in. */
export const ServerTotalsWhilePaging: Story = { args: { set: "three", complete: false, server: true } };
export const ServerTotalsWhilePagingDark: Story = { args: { set: "three", complete: false, server: true }, globals: { theme: "dark" } };
export const LargeAmounts: Story = { args: { set: "large" } };
export const TwoCurrenciesOneRow: Story = { args: { set: "mixed" } };
export const OneMonth: Story = { args: { set: "one" } };

/** Decision 0120: two months of income and expense rows, no hairlines, 32px between the months. */
export const TwoMonthsMercury: Story = { args: { set: "two" } };
export const TwoMonthsMercuryDark: Story = { args: { set: "two" }, globals: { theme: "dark" } };

/** FLOW-305: quiet day heads (h3) under each sticky month head, and month totals with exact cents. */
export const DayHeads: Story = { args: { set: "two", days: true } };
export const DayHeadsDark: Story = { args: { set: "two", days: true }, globals: { theme: "dark" } };
export const DayHeads320: Story = { args: { set: "two", days: true }, parameters: { viewport: { defaultViewport: "flow320" } } };
export const DayHeadsOneMonth: Story = { args: { set: "one", days: true } };
