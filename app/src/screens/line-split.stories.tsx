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

function storyOf(render: () => ReactElement): Story {
  return { render };
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

const expense = storyOf(() => <Editor parts={expenseParts} />);
export const Expense: Story = { ...expense, name: "Expense: 30% + ₪500 + the rest" };

const refundParts: PartDraft[] = [
  { key: "a", categoryId: "c-build", projectId: null, unit: "percent", value: "40" },
  { key: "b", categoryId: "c-subs", projectId: "p-herz", unit: "amount", value: "200" },
];

const refund = storyOf(() => <Editor line={SAMPLE_REFUND_LINE} parts={refundParts} warned />);
export const RefundMissingProject: Story = { ...refund, name: "Refund: a reversal part needs a project" };

const overParts: PartDraft[] = [
  { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "percent", value: "70" },
  { key: "b", categoryId: "c-ins", projectId: "p-raan", unit: "amount", value: "2000" },
];

const over = storyOf(() => <Editor parts={overParts} warned />);
export const OverTheLine: Story = { ...over, name: "Parts exceed the line" };

// FLOW-333 C1: the ₪ field fits ₪9,999,999.99 at 320, and the share reads with separators.
const bigParts: PartDraft[] = [
  { key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "9999999.99" },
  { key: "b", categoryId: "c-ins", projectId: "p-raan", unit: "amount", value: "1234.56" },
];
const big = storyOf(() => <Editor line={{ ...SAMPLE_EXPENSE_LINE, amountNet: -2_000_000_000n }} parts={bigParts} />);
export const BigAmounts: Story = { ...big, name: "Big amounts: ₪9,999,999.99" };

const huge = storyOf(() => <Editor parts={[{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "1234567.89" }]} />);
export const ShareOverThousand: Story = { ...huge, name: "Share past 1,000%" };

const empty = storyOf(() => <Editor />);
export const Empty: Story = { ...empty, name: "Empty" };

const saving = storyOf(() => <Editor parts={expenseParts} saving />);
export const Saving: Story = saving;

const reviewBlocked = storyOf(() => <Editor line={{ ...SAMPLE_EXPENSE_LINE, reviewBlocked: true }} />);
export const BlockedByReview: Story = reviewBlocked;

const nothingLeft = storyOf(() => (
  <Editor parts={[{ key: "a", categoryId: "c-elec", projectId: "p-herz", unit: "amount", value: "4800" }]} warned />
));
export const NothingLeft: Story = { ...nothingLeft, name: "Nothing is left for the rest" };

const noCategory = storyOf(() => (
  <Editor line={{ ...SAMPLE_EXPENSE_LINE, categoryId: null, categoryName: null }} parts={expenseParts} warned />
));
export const NoLineCategory: Story = { ...noCategory, name: "Line with no category" };

const loanBlocked = storyOf(() => <Editor line={{ ...SAMPLE_EXPENSE_LINE, loanSplit: true }} />);
export const BlockedByLoan: Story = loanBlocked;

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

const reopened = storyOf(() => <Editor split={savedSplit} />);
export const Reopened: Story = { ...reopened, name: "Reopened saved split" };

/** A bank re-sync moved the line from ₪4,800 to ₪5,000: the saved parts no longer sum to it. */
const mismatchSplit: LineSplitRead = { ...savedSplit, lineMinor: 500_000n, partsMatch: false };

const mismatch = storyOf(() => (
  <Editor line={{ ...SAMPLE_EXPENSE_LINE, amountNet: -500_000n }} split={mismatchSplit} />
));
export const PartsMismatch: Story = { ...mismatch, name: "Parts no longer match the line" };

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

const readView = storyOf(() => <Detail />);
export const ReadView: Story = { ...readView, name: "Read view on the detail" };

const viewerView = storyOf(() => <Detail viewer />);
export const ReadViewViewer: Story = { ...viewerView, name: "Read view, viewer" };

const unsplit = storyOf(() => (
  <StoryRoute entry={`/transactions/${detailLine.id}`}>
    <TransactionScreen sample={detailLine} sampleCategories={SAMPLE_SPLIT_CATEGORIES} sampleProjects={SAMPLE_SPLIT_PROJECTS} sampleLineSplit={null} />
  </StoryRoute>
));
export const DetailEntry: Story = { ...unsplit, name: "Detail entry rows" };
