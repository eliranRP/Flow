import type { Meta, StoryObj } from "@storybook/react";
import { EmptyState } from "./empty-state";
import { Button } from "./button";
import { ReviewIcon } from "./icons";
import { ReviewSkippedLink, ReviewSkippedList, type SkippedRowView } from "./review-skipped-list";
import { statementMethodOf } from "./statement";

/** FLOW-309: the דולגו block at the end of הצגת הכול. Invented data. */
const rows: SkippedRowView[] = [
  {
    id: "r1",
    title: "חומרי בניין לדוגמה בע״מ",
    fallback: "invoice",
    method: statementMethodOf("sumit", "invoice"),
    suggestion: "וילה רעננה · חומרים",
    agorot: 850000n,
    sign: "out",
    href: "/transactions/t1",
  },
  {
    id: "r2",
    title: "Example Office Suite",
    fallback: "bank",
    method: statementMethodOf("mercury", undefined),
    suggestion: null,
    pending: true,
    agorot: 125000n,
    currency: "USD",
    sign: "out",
    href: "/transactions/t2",
  },
  {
    id: "r3",
    title: "שיפוצים בע״מ — לקוח פרטי עם שם ארוך מאוד שנחתך בסוף השורה",
    fallback: "invoice",
    suggestion: "בית בהרצליה",
    agorot: 2400000n,
    sign: "in",
    href: "/transactions/t3",
  },
];

/** Story args hold no bigint (story-args.test), so the rows live here. */
function SkippedView({ state, busyId, viewer = false, empty = false }: { state: "rows" | "error"; busyId?: string; viewer?: boolean; empty?: boolean }) {
  return (
    <ReviewSkippedList
      state={state}
      rows={state === "error" || empty ? [] : rows}
      busyId={busyId}
      onReopen={viewer ? undefined : () => undefined}
      onRetry={() => undefined}
    />
  );
}

const meta = {
  title: "Components/ReviewSkippedList",
  component: SkippedView,
  args: { state: "rows" },
} satisfies Meta<typeof SkippedView>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "dark" } };
const narrow = { parameters: { viewport: { defaultViewport: "flow320" } } };

export const Rows: Story = {};
export const RowsDark: Story = { ...dark };
export const Rows320: Story = { ...narrow };
export const Busy: Story = { args: { busyId: "r1" } };
/** A viewer sees the rows without החזרה לתור. */
export const Viewer: Story = { args: { viewer: true } };
export const LoadError: Story = { args: { state: "error" } };
export const LoadErrorDark: Story = { ...dark, args: { state: "error" } };
export const LoadError320: Story = { ...narrow, args: { state: "error" } };
/** No rows: nothing renders. */
export const Empty: Story = { tags: ["clip-no-text"], args: { empty: true } };

/** Owner pick 2026-10-08: under הכל מאושר, a link to the skipped cards. */
function EmptyWithLink({ count }: { count: number }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <EmptyState
        icon={<ReviewIcon />}
        title="הכל מאושר"
        body="אין פריטים שמחכים לך. נעדכן כשיגיע משהו חדש."
        action={(
          <>
            <Button variant="pill" to="/">לדף הבית</Button>
            <ReviewSkippedLink count={count} to="/review/all#review-skipped" />
          </>
        )}
      />
    </div>
  );
}
export const EmptyQueueLink: Story = { render: () => <EmptyWithLink count={3} /> };
export const EmptyQueueLinkOne: Story = { render: () => <EmptyWithLink count={1} /> };
export const EmptyQueueLinkDark: Story = { ...dark, render: () => <EmptyWithLink count={3} /> };
export const EmptyQueueLink320: Story = { ...narrow, render: () => <EmptyWithLink count={12} /> };
