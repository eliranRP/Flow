import type { ReviewRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { ReviewAllList, ReviewEmpty as ReviewEmptyState, ReviewQueue, ReviewScreen } from "./flow-screens";
import { israelToday } from "../ui/date-math";
import { StoryRoute } from "../ui/story-route";
import { SeedLineMeta, storyMeta } from "../ui/story-support";
import type { TxnMeta } from "../txn-meta";
import { bareReview, ExampleBar, filedTodayCount, sampleReview, SeedSkipped } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReviewEmpty: Story = {
  render: () => (
    <StoryRoute entry="/review?preview=empty" tabs>
      <ExampleBar />
      <ReviewScreen />
    </StoryRoute>
  ),
};

export const ReviewCardQueue: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[sampleReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewCardViewer: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1} viewer>
      <ExampleBar />
      <ReviewQueue rows={[sampleReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewAll: Story = {
  render: () => (
    <StoryRoute entry="/review/all" tabs reviewCount={2}>
      <SeedSkipped rows={[]} />
      <ExampleBar />
      <ReviewAllList
        backTo="/review"
        search=""
        rows={[
          { ...sampleReview, source: "sumit", doc_kind: "invoice", line_status: "posted" },
          {
            ...sampleReview,
            id: "r2",
            transaction_id: "t2",
            description: "מנוף ליום",
            doc_date: "2026-09-29",
            amount_net: -100_000n,
            supplier_name: "עגורני החוף בע״מ",
            project_name: null,
            category_name: "שינוע",
            source: "mercury",
            line_status: "pending",
          },
        ]}
      />
    </StoryRoute>
  ),
};

/** FLOW-305: the review list as a bank statement, two months, with היום / אתמול / date heads. Invented data. */
function reviewDay(daysAgo: number): string {
  const today = israelToday();
  const date = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) - daysAgo));
  return date.toISOString().slice(0, 10);
}

const statementReviews: ReviewRow[] = [
  { ...sampleReview, id: "s1", transaction_id: "ts1", doc_date: reviewDay(0), supplier_name: null, description: "Northwind Traders", amount_net: -4_299n, currency: "USD", source: "mercury", line_status: "pending", project_name: null, category_name: null },
  { ...sampleReview, id: "s2", transaction_id: "ts2", doc_date: reviewDay(0), supplier_name: "חשמל לדוגמה בע״מ", amount_net: -120_050n, source: "mercury", line_status: "posted" },
  { ...sampleReview, id: "s3", transaction_id: "ts3", doc_date: reviewDay(1), supplier_name: "לקוח לדוגמה", direction: "income", amount_net: 500_000n, source: "sumit", doc_kind: "invoice", project_name: "וילה רעננה", category_name: "מקדמות" },
  { ...sampleReview, id: "s4", transaction_id: "ts4", doc_date: reviewDay(3), supplier_name: "שיש לדוגמה", amount_net: -345_000n, source: "sumit", doc_kind: "receipt" },
  { ...sampleReview, id: "s5", transaction_id: "ts5", doc_date: reviewDay(40), supplier_name: "Contoso Building Supplies International", amount_net: -999_999_999n, currency: "USD", source: "mercury", line_status: "pending", category_name: "שיפוץ דירת הגג ברחוב הרצל, כולל הריסה וחשמל" },
  { ...sampleReview, id: "s6", transaction_id: "ts6", doc_date: reviewDay(41), supplier_name: null, description: "4242-1234", amount_net: -10_000n, source: "mercury", project_name: null, category_name: null },
];

/** FLOW-304 bank details for the bank lines above, seeded so the rows show card, ACH, wire and no method. */
const statementMeta: TxnMeta[] = [
  storyMeta("ts1", { method: "card", card_last4: "4242" }),
  storyMeta("ts2", { method: "ach" }),
  storyMeta("ts5", { method: "wire" }),
  storyMeta("ts6", {}),
];

function ReviewStatement() {
  return (
    <StoryRoute entry="/review/all" tabs reviewCount={statementReviews.length}>
      <SeedLineMeta meta={statementMeta} />
      <SeedSkipped rows={[]} />
      <ExampleBar />
      <ReviewAllList backTo="/review" search="" rows={statementReviews} />
    </StoryRoute>
  );
}

export const ReviewAllStatement: Story = { render: () => <ReviewStatement /> };
export const ReviewAllStatementDark: Story = { render: () => <ReviewStatement />, globals: { theme: "dark" } };
export const ReviewAllStatement320: Story = { render: () => <ReviewStatement />, parameters: { viewport: { defaultViewport: "flow320" } } };
export const ReviewAllStatement320Dark: Story = {
  render: () => <ReviewStatement />,
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
};

export const ReviewWithoutSuggestion: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[bareReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewBanner: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[sampleReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewBannerOne: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[{ ...sampleReview, auto_approved_today: 1, assistant_filed_today: false }]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewBannerAssistant: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[{ ...sampleReview, auto_approved_today: 3, assistant_filed_today: true }]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewBannerAssistantOne: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[{ ...sampleReview, auto_approved_today: 1, assistant_filed_today: true }]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewMissingProject: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...sampleReview,
          project_id: null,
          project_name: null,
          category_id: "c1",
          category_name: "חומרים",
          reason: "missing_project",
        }]}
        search=""
        sample
      />
    </StoryRoute>
  ),
};

export const ReviewFoldStress: Story = {
  name: "Fold stress",
  render: () => (
    <StoryRoute entry="/review?item=q-stress&from=all" tabs reviewCount={15}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...sampleReview,
          id: "q-stress",
          supplier_name: "חומרי בניין והובלות לדוגמה בע״מ",
          description: "חומרי בניין והובלות לדוגמה בע״מ",
          project_id: null,
          project_name: null,
          category_id: null,
          category_name: null,
          project_suggested: false,
          category_suggested: false,
          reason: "missing_category",
          pnl_role: "shared",
          share_count: 2,
          auto_approved_today: filedTodayCount,
        }]}
        search=""
        sample
        listPlace={{ index: 14, total: 15 }}
      />
    </StoryRoute>
  ),
};

const splitReviewRow: ReviewRow = {
  id: "q-split",
  transaction_id: "t-split",
  description: "מנוף ליום",
  doc_date: "2026-09-29",
  amount_net: -100_000n,
  direction: "expense",
  reason: "missing_category",
  pnl_role: "shared",
  share_count: 2,
  project_id: null,
  category_id: null,
  supplier_name: "עגורני החוף בע״מ",
  project_name: null,
  category_name: null,
  doc_kind: "invoice",
};

export const ReviewSplitMissingCategory: Story = {
  name: "Split missing category",
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue rows={[splitReviewRow]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewSplitCategorySaved: Story = {
  name: "Split category saved",
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...splitReviewRow,
          category_id: "c-haul",
          category_name: "שינוע",
          category_suggested: false,
        }]}
        search=""
        sample
      />
    </StoryRoute>
  ),
};

export const ReviewSharedCost: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...sampleReview,
          project_id: null,
          project_name: null,
          category_id: "c1",
          category_name: "חומרים",
          reason: "unallocated_shared",
        }]}
        search=""
        sample
      />
    </StoryRoute>
  ),
};

export const ReviewFiltered: Story = {
  render: () => (
    <StoryRoute entry="/review?project=a" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[sampleReview]}
        search="?project=a"
        sample
        backTo="/projects/a"
        homeTo="/projects/a"
        homeLabel="חזרה לפרויקט"
      />
    </StoryRoute>
  ),
};

export const ReviewFilteredEmpty: Story = {
  render: () => (
    <StoryRoute entry="/review?project=a" tabs>
      <ExampleBar />
      <ReviewEmptyState
        search="?project=a"
        filtered
        backTo="/projects/a"
        homeTo="/projects/a"
        homeLabel="חזרה לפרויקט"
      />
    </StoryRoute>
  ),
};

export const ReviewMissingCategory: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={1}>
      <ExampleBar />
      <ReviewQueue
        rows={[{
          ...sampleReview,
          project_id: "a",
          project_name: "וילה רעננה",
          category_id: null,
          category_name: null,
          reason: "missing_category",
        }]}
        search=""
        sample
      />
    </StoryRoute>
  ),
};

export const ReviewLoading: Story = {
  render: () => (
    <StoryRoute entry="/review?preview=loading" tabs>
      <ExampleBar />
      <ReviewScreen />
    </StoryRoute>
  ),
};

export const ReviewError: Story = {
  render: () => (
    <StoryRoute entry="/review?preview=error" tabs>
      <ExampleBar />
      <ReviewScreen />
    </StoryRoute>
  ),
};

const metaReviewRow: ReviewRow = {
  ...sampleReview,
  id: "q-meta",
  transaction_id: "t-meta",
  description: "EXAMPLE OFFICE SUITE",
  supplier_name: "Example Office Suite Holdings",
  amount_net: -125_000n,
  vat_agorot: 0n,
  currency: "USD",
  project_name: "Cedar Lot",
  category_name: "Office",
};

export const ReviewMetaFold: Story = {
  name: "Review bank details: fold with memo",
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={15}>
      <SeedLineMeta
        meta={[storyMeta("t-meta", { method: "wire", memo: "Invoice 1042 for the September office lease, parking, and storage" })]}
      />
      <ExampleBar />
      <ReviewQueue rows={[metaReviewRow]} search="" sample listPlace={{ index: 14, total: 15 }} />
    </StoryRoute>
  ),
};

export const ReviewMetaCard: Story = {
  name: "Review bank details: card",
  render: () => (
    <StoryRoute entry="/review" tabs reviewCount={15}>
      <SeedLineMeta meta={[storyMeta("t-meta", { method: "card", card_last4: "4242" })]} />
      <ExampleBar />
      <ReviewQueue rows={[metaReviewRow]} search="" sample />
    </StoryRoute>
  ),
};
