import type { TransactionDetail } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import type { ReactElement } from "react";
import {
  SAMPLE_EXPENSE_LINE,
  SAMPLE_REFUND_LINE,
  SAMPLE_SPLIT_CATEGORIES,
  SAMPLE_SPLIT_PROJECTS,
  sampleSplitApi,
} from "../dev/line-split-sample";
import type { LineSplitRead, PartDraft } from "../line-split";
import { StoryRoute } from "../ui/story-route";
import { TransactionScreen } from "./flow-screens";
import { LineSplitScreen, type LineInfo, type LineSplitSample } from "./line-split";

/**
 * FLOW-325, plan option A. Every state is set through props: a play must not focus or type,
 * so the layout check keeps its focus on the title. Invented data only.
 */
const meta = {
  title: "Screens/Line split",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function quadrant(render: () => ReactElement): { base: Story; dark: Story; narrow: Story; darkNarrow: Story } {
  return {
    base: { render },
    dark: { render, globals: { theme: "dark" } },
    narrow: { render, parameters: { viewport: { defaultViewport: "flow320" } } },
    darkNarrow: { render, globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } },
  };
}

function Editor({ line = SAMPLE_EXPENSE_LINE, ...rest }: Partial<LineSplitSample> & { line?: LineInfo }) {
  return (
    <StoryRoute entry={`/transactions/${line.id}/split-category`}>
      <LineSplitScreen
        sample={{
          line,
          categories: SAMPLE_SPLIT_CATEGORIES,
          projects: SAMPLE_SPLIT_PROJECTS,
          api: sampleSplitApi(line),
          ...rest,
        }}
      />
    </StoryRoute>
  );
}

const expenseParts: PartDraft[] = [
  { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "30" },
  { key: "b", categoryId: "c-ins", projectId: "p-raan", unit: "amount", value: "500" },
];

const expense = quadrant(() => <Editor parts={expenseParts} />);
export const Expense: Story = { ...expense.base, name: "Expense: 30% + ₪500 + the rest" };
export const ExpenseDark: Story = expense.dark;
export const Expense320: Story = expense.narrow;
export const ExpenseDark320: Story = expense.darkNarrow;

const refundParts: PartDraft[] = [
  { key: "a", categoryId: "c-build", projectId: null, unit: "percent", value: "40" },
  { key: "b", categoryId: "c-subs", projectId: "p-herz", unit: "amount", value: "200" },
];

const refund = quadrant(() => <Editor line={SAMPLE_REFUND_LINE} parts={refundParts} warned />);
export const RefundMissingProject: Story = { ...refund.base, name: "Refund: a reversal part needs a project" };
export const RefundMissingProjectDark: Story = refund.dark;
export const RefundMissingProject320: Story = refund.narrow;
export const RefundMissingProjectDark320: Story = refund.darkNarrow;

const overParts: PartDraft[] = [
  { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "70" },
  { key: "b", categoryId: "c-ins", projectId: "p-raan", unit: "amount", value: "2000" },
];

const over = quadrant(() => <Editor parts={overParts} warned />);
export const OverTheLine: Story = { ...over.base, name: "Parts exceed the line" };
export const OverTheLineDark: Story = over.dark;
export const OverTheLine320: Story = over.narrow;
export const OverTheLineDark320: Story = over.darkNarrow;

// FLOW-333 C1: the ₪ field fits ₪9,999,999.99 at 320, and the share reads with separators.
const bigParts: PartDraft[] = [
  { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "9999999.99" },
  { key: "b", categoryId: "c-ins", projectId: "p-raan", unit: "amount", value: "1234.56" },
];
const big = quadrant(() => <Editor line={{ ...SAMPLE_EXPENSE_LINE, amountNet: -2_000_000_000n }} parts={bigParts} />);
export const BigAmounts: Story = { ...big.base, name: "Big amounts: ₪9,999,999.99" };
export const BigAmountsDark: Story = big.dark;
export const BigAmounts320: Story = big.narrow;
export const BigAmountsDark320: Story = big.darkNarrow;

const huge = quadrant(() => <Editor parts={[{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "1234567.89" }]} />);
export const ShareOverThousand: Story = { ...huge.base, name: "Share past 1,000%" };
export const ShareOverThousandDark: Story = huge.dark;
export const ShareOverThousand320: Story = huge.narrow;
export const ShareOverThousandDark320: Story = huge.darkNarrow;

const empty = quadrant(() => <Editor />);
export const Empty: Story = { ...empty.base, name: "Empty" };
export const EmptyDark: Story = empty.dark;
export const Empty320: Story = empty.narrow;
export const EmptyDark320: Story = empty.darkNarrow;

const saving = quadrant(() => <Editor parts={expenseParts} saving />);
export const Saving: Story = saving.base;
export const SavingDark: Story = saving.dark;
export const Saving320: Story = saving.narrow;
export const SavingDark320: Story = saving.darkNarrow;

const reviewBlocked = quadrant(() => <Editor line={{ ...SAMPLE_EXPENSE_LINE, reviewBlocked: true }} />);
export const BlockedByReview: Story = reviewBlocked.base;
export const BlockedByReviewDark: Story = reviewBlocked.dark;
export const BlockedByReview320: Story = reviewBlocked.narrow;
export const BlockedByReviewDark320: Story = reviewBlocked.darkNarrow;

const nothingLeft = quadrant(() => (
  <Editor parts={[{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "4800" }]} warned />
));
export const NothingLeft: Story = { ...nothingLeft.base, name: "Nothing is left for the rest" };
export const NothingLeftDark: Story = nothingLeft.dark;
export const NothingLeft320: Story = nothingLeft.narrow;
export const NothingLeftDark320: Story = nothingLeft.darkNarrow;

const noCategory = quadrant(() => (
  <Editor line={{ ...SAMPLE_EXPENSE_LINE, categoryId: null, categoryName: null }} parts={expenseParts} warned />
));
export const NoLineCategory: Story = { ...noCategory.base, name: "Line with no category" };
export const NoLineCategoryDark: Story = noCategory.dark;
export const NoLineCategory320: Story = noCategory.narrow;
export const NoLineCategoryDark320: Story = noCategory.darkNarrow;

const loanBlocked = quadrant(() => <Editor line={{ ...SAMPLE_EXPENSE_LINE, loanSplit: true }} />);
export const BlockedByLoan: Story = loanBlocked.base;
export const BlockedByLoanDark: Story = loanBlocked.dark;
export const BlockedByLoan320: Story = loanBlocked.narrow;
export const BlockedByLoanDark320: Story = loanBlocked.darkNarrow;

/** The saved split the read view and the reopened editor show: 30%, ₪500, and the rest. */
const savedSplit: LineSplitRead = {
  transactionId: SAMPLE_EXPENSE_LINE.id,
  currency: "ILS",
  lineMinor: 480_000n,
  partsMatch: true,
  parts: [
    { category_id: "c-elec", category_name: "חשמל", project_id: "p-herz", project_name: "פרויקט הרצליה", amount_minor: 144_000n, percent: 30, rest: false },
    { category_id: "c-ins", category_name: "ביטוח", project_id: "p-raan", project_name: "פרויקט רעננה", amount_minor: 50_000n, percent: null, rest: false },
    { category_id: "c-build", category_name: "חומרי בניין", project_id: null, project_name: null, amount_minor: 286_000n, percent: null, rest: true },
  ],
};

const reopened = quadrant(() => <Editor split={savedSplit} />);
export const Reopened: Story = { ...reopened.base, name: "Reopened saved split" };
export const ReopenedDark: Story = reopened.dark;
export const Reopened320: Story = reopened.narrow;
export const ReopenedDark320: Story = reopened.darkNarrow;

/** A bank re-sync moved the line from ₪4,800 to ₪5,000: the saved parts no longer sum to it. */
const mismatchSplit: LineSplitRead = { ...savedSplit, lineMinor: 500_000n, partsMatch: false };

const mismatch = quadrant(() => (
  <Editor line={{ ...SAMPLE_EXPENSE_LINE, amountNet: -500_000n }} split={mismatchSplit} />
));
export const PartsMismatch: Story = { ...mismatch.base, name: "Parts no longer match the line" };
export const PartsMismatchDark: Story = mismatch.dark;
export const PartsMismatch320: Story = mismatch.narrow;
export const PartsMismatchDark320: Story = mismatch.darkNarrow;

const detailLine: NonNullable<TransactionDetail> = {
  id: SAMPLE_EXPENSE_LINE.id,
  description: "חומרי בניין אלון",
  direction: "expense",
  doc_date: "2026-10-06",
  amount_gross: -480_000n,
  amount_net: -480_000n,
  vat_amount: 0n,
  vat_status: "unknown",
  currency: "ILS",
  doc_kind: "expense",
  source: "mercury",
  pnl_role: "project",
  project_id: "p-givat",
  project_name: "פרויקט גבעתיים",
  category_id: "c-build",
  category_name: "חומרי בניין",
  supplier_name: "חומרי בניין אלון",
  customer_name: null,
  review_status: null,
  paid: true,
  open_gross_agorot: null,
};

function Detail({ viewer = false }: { viewer?: boolean }) {
  return (
    <StoryRoute entry={`/transactions/${detailLine.id}`} viewer={viewer}>
      <TransactionScreen sample={detailLine} sampleCategories={SAMPLE_SPLIT_CATEGORIES} sampleProjects={SAMPLE_SPLIT_PROJECTS} sampleLineSplit={savedSplit} />
    </StoryRoute>
  );
}

const readView = quadrant(() => <Detail />);
export const ReadView: Story = { ...readView.base, name: "Read view on the detail" };
export const ReadViewDark: Story = readView.dark;
export const ReadView320: Story = readView.narrow;
export const ReadViewDark320: Story = readView.darkNarrow;

const viewerView = quadrant(() => <Detail viewer />);
export const ReadViewViewer: Story = { ...viewerView.base, name: "Read view, viewer" };
export const ReadViewViewerDark: Story = viewerView.dark;
export const ReadViewViewer320: Story = viewerView.narrow;
export const ReadViewViewerDark320: Story = viewerView.darkNarrow;

const unsplit = quadrant(() => (
  <StoryRoute entry={`/transactions/${detailLine.id}`}>
    <TransactionScreen sample={detailLine} sampleCategories={SAMPLE_SPLIT_CATEGORIES} sampleProjects={SAMPLE_SPLIT_PROJECTS} sampleLineSplit={null} />
  </StoryRoute>
));
export const DetailEntry: Story = { ...unsplit.base, name: "Detail entry rows" };
export const DetailEntryDark: Story = unsplit.dark;
export const DetailEntry320: Story = unsplit.narrow;
export const DetailEntryDark320: Story = unsplit.darkNarrow;
