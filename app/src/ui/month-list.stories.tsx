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
const SETS = { three: ROWS, large: LARGE, one: ROWS.slice(0, 2) } as const;

function MonthListView({ set, complete = true }: { set: keyof typeof SETS; complete?: boolean }) {
  const rows: readonly Row[] = SETS[set];
  return (
    <MonthList
      rows={rows}
      keyOf={(row) => row.id}
      dateOf={(row) => row.date}
      amountOf={(row) => ({ minor: row.minor, currency: row.currency, direction: row.direction })}
      complete={complete}
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
export const LargeAmounts: Story = { args: { set: "large" } };
export const OneMonth: Story = { args: { set: "one" } };
