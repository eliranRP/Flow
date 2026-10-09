import type { ReviewRow } from "@flow/shared";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { type SkippedReviewRow } from "./review-skipped";
import { reviewFlagsQueryKey, type JevQueueData, type ReviewFlagsData } from "./jev-review";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { ReviewAllList, ReviewEmpty as ReviewEmptyState, ReviewQueue } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { bareReview, sampleReview, SeedSkipped } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const se = { parameters: { viewport: { defaultViewport: "flow375-se" } } };
const tall = { parameters: { viewport: { defaultViewport: "flow393" } } };
const narrowView = { parameters: { viewport: { defaultViewport: "flow320" } } };
const darkTheme = { globals: { theme: "dark" } };

/** FLOW-327: the card with its bar pinned on the tab bar. */
function ReviewQueueStory({ row = sampleReview, viewer = false }: { row?: ReviewRow; viewer?: boolean }) {
  return (
    <StoryRoute entry="/review" tabs reviewCount={4} viewer={viewer}>
      <ReviewQueue rows={[row]} search="" sample />
    </StoryRoute>
  );
}
export const ReviewBar375: Story = { ...se, render: () => <ReviewQueueStory /> };
export const ReviewBar375Dark: Story = { ...se, ...darkTheme, render: () => <ReviewQueueStory /> };
export const ReviewBar393: Story = { ...tall, render: () => <ReviewQueueStory /> };
export const ReviewBar393Dark: Story = { ...tall, ...darkTheme, render: () => <ReviewQueueStory /> };
export const ReviewBar320: Story = { ...narrowView, render: () => <ReviewQueueStory /> };
export const ReviewBar320Dark: Story = { ...narrowView, ...darkTheme, render: () => <ReviewQueueStory /> };
const plainRow: ReviewRow = { ...sampleReview, auto_approved_today: 0 };
export const ReviewBarNoBanner375: Story = { ...se, render: () => <ReviewQueueStory row={plainRow} /> };
export const ReviewBarBothMissing375: Story = { ...se, render: () => <ReviewQueueStory row={{ ...bareReview, auto_approved_today: 0 }} /> };
export const ReviewBarBothMissing320: Story = { ...narrowView, render: () => <ReviewQueueStory row={{ ...bareReview, auto_approved_today: 0 }} /> };
const sharedRow: ReviewRow = { ...plainRow, project_id: null, project_name: null, reason: "unallocated_shared" };
export const ReviewBarSharedCost375: Story = { ...se, render: () => <ReviewQueueStory row={sharedRow} /> };
const mismatchRow: ReviewRow = { ...plainRow, reason: "split_mismatch" };
export const ReviewBarSplitMismatch375: Story = { ...se, render: () => <ReviewQueueStory row={mismatchRow} /> };
export const ReviewBarSplitMismatch320Dark: Story = { ...narrowView, ...darkTheme, render: () => <ReviewQueueStory row={mismatchRow} /> };
export const ReviewBarViewer375: Story = { ...se, render: () => <ReviewQueueStory viewer /> };

/** FLOW-327 r1: a project's queue has Back; its header stays on one line so the bar clears the tab bar. */
function ReviewFilteredBarStory({ row }: { row: ReviewRow }) {
  return (
    <StoryRoute entry="/review?project=a" tabs reviewCount={4}>
      <ReviewQueue rows={[row]} search="?project=a" sample backTo="/projects/a" homeTo="/projects/a" homeLabel="חזרה לפרויקט" />
    </StoryRoute>
  );
}
const sharedBannerRow: ReviewRow = { ...sampleReview, project_id: null, project_name: null, reason: "unallocated_shared" };
export const ReviewFilteredBarSharedBanner375: Story = { ...se, render: () => <ReviewFilteredBarStory row={sharedBannerRow} /> };
export const ReviewFilteredBarSharedBanner375Dark: Story = { ...se, ...darkTheme, render: () => <ReviewFilteredBarStory row={sharedBannerRow} /> };

/** Puts flags in the story's cache under the key the real read uses. */
function SeedFlags({ ids, flags }: { ids: string[]; flags: ReviewFlagsData }) {
  const client = useQueryClient();
  useState(() => {
    client.setQueryData(reviewFlagsQueryKey(ids), flags);
    return true;
  });
  return null;
}
const flagRow: ReviewRow = { ...plainRow };
const loudSpike: ReviewFlagsData = {
  [flagRow.transaction_id]: [{
    transaction_id: flagRow.transaction_id, kind: "amount_spike", jev_score: 0.82, other_doc_date: null, typical_amount_minor: 120_000, ratio: 3.4,
  }],
};
/** FLOW-327: a loud flag as the card's last block, the bar still clear of the tab bar at 375x667. */
function ReviewQueueFlagStory() {
  return (
    <StoryRoute entry="/review" tabs reviewCount={4}>
      <SeedFlags ids={[flagRow.transaction_id]} flags={loudSpike} />
      <ReviewQueue rows={[flagRow]} search="" sample />
    </StoryRoute>
  );
}
export const ReviewQueueFlag375se: Story = { ...se, render: () => <ReviewQueueFlagStory /> };
export const ReviewQueueFlag375seDark: Story = { ...se, ...darkTheme, render: () => <ReviewQueueFlagStory /> };

/**
 * FLOW-333 C13: the tallest everyday Jev card at 375x667. Jev filled both fields ("✦ מולא ע״י Jev" + בטל),
 * a quiet flag ends the card, and the slim filed-today banner is on. The card must end above the pinned bar.
 * Invented data.
 */
const jevRow: ReviewRow = { ...sampleReview, project_suggested: true, category_suggested: true };
const jevFilled: JevQueueData = {
  connectorOn: true,
  byId: {
    [jevRow.transaction_id]: {
      suggestionId: "s-fit",
      transactionId: jevRow.transaction_id,
      project: { id: jevRow.project_id ?? "a", name: jevRow.project_name ?? "וילה רעננה" },
      category: { id: jevRow.category_id ?? "c1", name: jevRow.category_name ?? "חומרים" },
      why: { reason: "usual_for_party", partyFilings: 5, matchingFilings: 4 },
      auto: { state: "filled", projectId: jevRow.project_id, categoryId: jevRow.category_id },
    },
  },
};
/** The same answer before the auto job filled it: the reason line instead of the filled line. */
const jevSuggested: JevQueueData = {
  connectorOn: true,
  byId: Object.fromEntries(Object.entries(jevFilled.byId).map(([id, prefill]) => [id, prefill == null ? null : { ...prefill, auto: undefined }])),
};
const quietSpike: ReviewFlagsData = {
  [jevRow.transaction_id]: [{
    transaction_id: jevRow.transaction_id, kind: "amount_spike", jev_score: 0.4, other_doc_date: null, typical_amount_minor: 250_000, ratio: 3.4,
  }],
};
const loudDuplicate: ReviewFlagsData = {
  [jevRow.transaction_id]: [{
    transaction_id: jevRow.transaction_id, kind: "duplicate", jev_score: 0.9, other_doc_date: "2026-09-20", typical_amount_minor: null, ratio: null,
  }],
};
function ReviewJevFitStory({ jev = jevFilled, flags = quietSpike }: { jev?: JevQueueData; flags?: ReviewFlagsData }) {
  return (
    <StoryRoute entry="/review" tabs reviewCount={4}>
      <SeedFlags ids={[jevRow.transaction_id]} flags={flags} />
      <ReviewQueue rows={[jevRow]} search="" sample sampleJev={jev} />
    </StoryRoute>
  );
}
export const ReviewJevFit375: Story = { ...se, render: () => <ReviewJevFitStory /> };
export const ReviewJevFit375Dark: Story = { ...se, ...darkTheme, render: () => <ReviewJevFitStory /> };
export const ReviewJevFit320: Story = { ...narrowView, render: () => <ReviewJevFitStory /> };
export const ReviewJevFit320Dark: Story = { ...narrowView, ...darkTheme, render: () => <ReviewJevFitStory /> };
export const ReviewJevFit390: Story = { parameters: { viewport: { defaultViewport: "flow390" } }, render: () => <ReviewJevFitStory /> };
export const ReviewJevFit390Dark: Story = { parameters: { viewport: { defaultViewport: "flow390" } }, ...darkTheme, render: () => <ReviewJevFitStory /> };
export const ReviewJevReason375: Story = { ...se, render: () => <ReviewJevFitStory jev={jevSuggested} /> };
export const ReviewJevFitLoud375: Story = { ...se, render: () => <ReviewJevFitStory flags={loudDuplicate} /> };

/** FLOW-327 / 0137: after דלג, the undo toast sits just above the bar. */
const skipRows: ReviewRow[] = [plainRow, { ...plainRow, id: "r2", transaction_id: "t2", supplier_name: "שיש הגליל", amount_net: -345_000n }];
function ReviewQueueSkipStory() {
  const [rows, setRows] = useState(skipRows);
  return (
    <StoryRoute entry="/review" tabs reviewCount={rows.length}>
      <ReviewQueue
        rows={rows}
        search=""
        sample
        previewWrite={{
          run: () => Promise.resolve(),
          onDone: (id) => { setRows((current) => current.filter((row) => row.id !== id)); },
          onUndo: () => { setRows(skipRows); },
        }}
      />
    </StoryRoute>
  );
}
export const ReviewQueueSkipToast: Story = {
  ...se,
  render: () => <ReviewQueueSkipStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "דלג" }));
    await canvas.findByText("דילגנו על הפריט");
  },
};

/** FLOW-309: the skipped cards at the end of הצג הכול. Invented data. */
const skippedSample: SkippedReviewRow[] = [
  {
    id: "k1", transaction_id: "tk1", description: "ברזל הצפון", doc_date: "2026-09-28", doc_kind: "invoice",
    amount_net: -250_000n, currency: "ILS", direction: "expense", line_status: "posted", source: "sumit",
    project_name: "וילה רעננה", category_name: "חומרים", supplier_name: "ברזל הצפון בע״מ", skipped_at: "2026-09-30T08:00:00Z",
  },
  {
    id: "k2", transaction_id: "tk2", description: "Northwind Traders", doc_date: "2026-09-26", doc_kind: null,
    amount_net: -4_299n, currency: "USD", direction: "expense", line_status: "pending", source: "mercury",
    project_name: null, category_name: null, supplier_name: null, skipped_at: "2026-09-29T08:00:00Z",
  },
];
function ReviewAllSkippedStory({ rows, skipped }: { rows: ReviewRow[]; skipped: SkippedReviewRow[] }) {
  return (
    <StoryRoute entry="/review/all" tabs reviewCount={rows.length}>
      <SeedSkipped rows={skipped} />
      <ReviewAllList backTo="/review" search="" rows={rows} />
    </StoryRoute>
  );
}
const pendingRows: ReviewRow[] = [plainRow, { ...plainRow, id: "r2", transaction_id: "t2", supplier_name: "שיש הגליל", amount_net: -345_000n }];
export const ReviewAllSkipped: Story = { render: () => <ReviewAllSkippedStory rows={pendingRows} skipped={skippedSample} /> };
export const ReviewAllSkippedDark: Story = { ...darkTheme, render: () => <ReviewAllSkippedStory rows={pendingRows} skipped={skippedSample} /> };
export const ReviewAllSkipped320: Story = { ...narrowView, render: () => <ReviewAllSkippedStory rows={pendingRows} skipped={skippedSample} /> };
export const ReviewAllSkippedOnly: Story = { render: () => <ReviewAllSkippedStory rows={[]} skipped={skippedSample} /> };
export const ReviewAllSkippedOnly320Dark: Story = { ...narrowView, ...darkTheme, render: () => <ReviewAllSkippedStory rows={[]} skipped={skippedSample} /> };

/** Owner pick 2026-10-08: הכל מאושר with a link to the skipped cards. */
function ReviewEmptySkippedStory() {
  return (
    <StoryRoute entry="/review" tabs>
      <SeedSkipped rows={skippedSample} />
      <ReviewEmptyState search="" skippedLink />
    </StoryRoute>
  );
}
export const ReviewEmptySkippedLink: Story = { render: () => <ReviewEmptySkippedStory /> };
export const ReviewEmptySkippedLink320Dark: Story = { ...narrowView, ...darkTheme, render: () => <ReviewEmptySkippedStory /> };
