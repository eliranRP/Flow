import type { ReviewRow } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReviewAllList, ReviewQueue, ReviewScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { SeedLineMeta, storyMeta } from "../ui/story-support";
import { ExampleBar, filedTodayCount, sampleReview } from "../ui/screen-stories-support";

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
    <StoryRoute entry="/review" tabs>
      <ExampleBar />
      <ReviewQueue rows={[sampleReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewCardViewer: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs viewer>
      <ExampleBar />
      <ReviewQueue rows={[sampleReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewAll: Story = {
  render: () => (
    <StoryRoute entry="/review/all" tabs>
      <ExampleBar />
      <ReviewAllList
        backTo="/review"
        search=""
        rows={[
          { ...sampleReview, source: "sumit", doc_kind: "invoice" },
          {
            ...sampleReview,
            id: "r2",
            transaction_id: "t2",
            description: "מנוף ליום",
            doc_date: "2026-09-29",
            amount_net: -100_000n,
            supplier_name: "עגורני החוף בע״מ",
            // FLOW-960: no project, so the row shows the warning mark.
            project_id: null,
            project_name: null,
            category_name: "שינוע",
            source: "mercury",
          },
        ]}
      />
    </StoryRoute>
  ),
};

export const ReviewBanner: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs>
      <ExampleBar />
      <ReviewQueue rows={[sampleReview]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewMissingProject: Story = {
  render: () => (
    <StoryRoute entry="/review" tabs>
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
    <StoryRoute entry="/review?item=q-stress&from=all" tabs>
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
    <StoryRoute entry="/review" tabs>
      <ExampleBar />
      <ReviewQueue rows={[splitReviewRow]} search="" sample />
    </StoryRoute>
  ),
};

export const ReviewFiltered: Story = {
  render: () => (
    <StoryRoute entry="/review?project=a" tabs>
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
    <StoryRoute entry="/review" tabs>
      <SeedLineMeta
        meta={[storyMeta("t-meta", { method: "wire", memo: "Invoice 1042 for the September office lease, parking, and storage" })]}
      />
      <ExampleBar />
      <ReviewQueue rows={[metaReviewRow]} search="" sample listPlace={{ index: 14, total: 15 }} />
    </StoryRoute>
  ),
};
