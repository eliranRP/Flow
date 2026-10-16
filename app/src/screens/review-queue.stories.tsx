import type { ReviewRow } from "@flow/shared";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reviewFlagsQueryKey, type JevQueueData, type ReviewFlagsData } from "./jev-review";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { ReviewQueue } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { pinReviewLine } from "../review-pin";
import { bareReview, sampleReview } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const se = { parameters: { viewport: { defaultViewport: "flow375-se" } } };
const tall = { parameters: { viewport: { defaultViewport: "flow393" } } };

/** FLOW-327: the card with its bar pinned on the tab bar. */
function ReviewQueueStory({ row = sampleReview, viewer = false }: { row?: ReviewRow; viewer?: boolean }) {
  return (
    <StoryRoute entry="/review" tabs reviewCount={1} viewer={viewer}>
      <ReviewQueue rows={[row]} search="" sample />
    </StoryRoute>
  );
}
export const ReviewBar375: Story = { ...se, render: () => <ReviewQueueStory /> };
export const ReviewBar393: Story = { ...tall, render: () => <ReviewQueueStory /> };
const plainRow: ReviewRow = { ...sampleReview, auto_approved_today: 0 };
export const ReviewBarNoBanner375: Story = { ...se, render: () => <ReviewQueueStory row={plainRow} /> };
export const ReviewBarBothMissing375: Story = { ...se, render: () => <ReviewQueueStory row={{ ...bareReview, auto_approved_today: 0 }} /> };
const sharedRow: ReviewRow = { ...plainRow, project_id: null, project_name: null, reason: "unallocated_shared" };
export const ReviewBarSharedCost375: Story = { ...se, render: () => <ReviewQueueStory row={sharedRow} /> };
const mismatchRow: ReviewRow = { ...plainRow, reason: "split_mismatch" };
export const ReviewBarSplitMismatch375: Story = { ...se, render: () => <ReviewQueueStory row={mismatchRow} /> };
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
    transaction_id: flagRow.transaction_id, kind: "amount_spike", jev_score: 0.82, other_doc_date: null, typical_amount_minor: 250_000, ratio: 3.4,
  }],
};
/**
 * FLOW-327: a loud amount spike, the bar still clear of the tab bar at 375x667.
 * 2026-10-09 option A: "↑ 240%" after the amount, "בדרך כלל ₪2,500" under it, and no flag row beside the pill.
 * `banner` adds the filed-today banner. The one-line loud row under the banner (#296) is in ReviewJevFitLoud*.
 */
function ReviewQueueFlagStory({ banner = false }: { banner?: boolean }) {
  const row = banner ? sampleReview : flagRow;
  return (
    <StoryRoute entry="/review" tabs reviewCount={4}>
      <SeedFlags ids={[row.transaction_id]} flags={{ [row.transaction_id]: loudSpike[flagRow.transaction_id] ?? [] }} />
      <ReviewQueue rows={[row]} search="" sample />
    </StoryRoute>
  );
}
const view390 = { parameters: { viewport: { defaultViewport: "flow390" } } };
export const ReviewQueueFlag375se: Story = { ...se, render: () => <ReviewQueueFlagStory /> };
export const ReviewQueueFlag390: Story = { ...view390, render: () => <ReviewQueueFlagStory banner /> };

/**
 * FLOW-333 C13: the tallest everyday Jev card at 375x667. Jev filled both fields ("✦ מולא ע״י Jev" + ביטול),
 * a quiet amount spike ("↑ 240%" after the amount, "בדרך כלל ₪2,500" under it; option A, 2026-10-09), and
 * the slim filed-today banner is on. The card must end above the pinned bar. Invented data.
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
export const ReviewJevReason375: Story = { ...se, render: () => <ReviewJevFitStory jev={jevSuggested} /> };
export const ReviewJevFitLoud375: Story = { ...se, render: () => <ReviewJevFitStory flags={loudDuplicate} /> };

/** FLOW-327 / 0137: after דלג, the undo toast sits just above the bar. */
const skipRows: ReviewRow[] = [plainRow, { ...plainRow, id: "r2", transaction_id: "t2", supplier_name: "שיש לדוגמה", amount_net: -345_000n }];
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

/**
 * FLOW-309: the short-phone worst case at 320x693: a supplier that wraps, Jev's reason line and the
 * plural filed-today banner. The card ends above the pinned bar, and the bar sits on the tab bar.
 */
const shortPhone = { parameters: { viewport: { defaultViewport: "flow320-short" } } };
const fitRow: ReviewRow = { ...jevRow, supplier_name: "חומרי בניין ואינסטלציה לדוגמה בע״מ" };
function ReviewFitStory() {
  return (
    <StoryRoute entry="/review" tabs reviewCount={4}>
      <ReviewQueue rows={[fitRow]} search="" sample sampleJev={jevSuggested} />
    </StoryRoute>
  );
}
export const ReviewFit320Short: Story = { ...shortPhone, render: () => <ReviewFitStory /> };

/** FLOW-309: "10 מתוך 12" after nine skips. The counter reserves the total's digits, so nothing moved. */
const countRows: ReviewRow[] = Array.from({ length: 12 }, (_, n) => ({
  ...plainRow, id: `r${String(n + 1)}`, transaction_id: `t${String(n + 1)}`, supplier_name: `ספק לדוגמה ${String(n + 1)}`,
}));
function ReviewCounterStory() {
  const [rows, setRows] = useState(countRows);
  return (
    <StoryRoute entry="/review" tabs reviewCount={rows.length}>
      <ReviewQueue
        rows={rows}
        search=""
        sample
        previewWrite={{
          run: () => Promise.resolve(),
          onDone: (id) => { setRows((current) => current.filter((row) => row.id !== id)); },
          onUndo: () => { setRows(countRows); },
        }}
      />
    </StoryRoute>
  );
}
const skipToTen: Story["play"] = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  for (let step = 2; step <= 10; step += 1) {
    await userEvent.click(await canvas.findByRole("button", { name: "דלג" }));
    await canvas.findByText(`ספק לדוגמה ${String(step)}`, {}, { timeout: 3000 });
  }
};
/** The pinned line is module state (review-pin.ts); the story before may have left one. */
const unpin: NonNullable<Story["loaders"]> = [() => {
  pinReviewLine(null);
  return Promise.resolve({});
}];
export const ReviewCounter10At: Story = { loaders: unpin, render: () => <ReviewCounterStory />, play: skipToTen };


