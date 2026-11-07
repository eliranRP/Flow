import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { LOAN_SUMMARY_SAMPLE } from "../dev/loan-summary-sample";
import { sampleLoanStore } from "../dev/loan-detail-sample";
import { StoryRoute } from "../ui/story-route";
import { longHebrew, oneLineAttention } from "../ui/story-support";
import { ViewerPreview } from "../use-is-viewer";
import { ExampleBar, pagesBusiness, storyBody } from "../ui/screen-stories-support";
import type { LoanListRow } from "./loan-list";
import { LoansScreen, type LoansSample } from "./loans-screen";

/**
 * The הלוואות tab (FLOW-139b, FLOW-1046 V3-Loans): the band with what is left to pay, דורש טיפול, the פעילות /
 * נסגרו segment and the rows in groups by kind. Invented loans.
 */
const ROWS = sampleLoanStore().rows();

const pagesLoans: LoanListRow[] = [
  { id: "l1", name: "משכנתא אלון", currency: "USD", balanceMinor: 20_000_000n, flaggedParts: 2, projectId: "p1", projectName: "וילה אלון", next: { dueDate: "2026-11-20", amountMinor: 524_000n } },
  { id: "l2", name: "הלוואת ציוד", currency: "USD", balanceMinor: 5_000_000n, flaggedParts: 1, projectId: "p2", projectName: "פרויקט גפן", kind: "interest_only", next: { dueDate: "2026-11-15", amountMinor: 131_200n } },
];

/** Long names and many rows, for the long-content state (V3-States). */
const LONG_ROWS: LoanListRow[] = Array.from({ length: 14 }, (_, index) => ({
  id: `long-${String(index)}`,
  name: index === 0 ? longHebrew : `הלוואה ${String(index + 1)}`,
  currency: "USD",
  balanceMinor: BigInt(10_000_000 + index * 1_234_500),
  flaggedParts: 0,
  projectId: null,
  projectName: index === 0 ? longHebrew : `פרויקט ${String(index + 1)}`,
  kind: index % 3 === 0 ? "interest_only" : index % 3 === 1 ? "amortizing" : "demand",
  ...(index % 3 === 2 ? {} : { next: { dueDate: "2026-12-01", amountMinor: 250_000n } }),
}));

/**
 * Stories pick the loans by name, never as args: the loans carry bigint amounts, and Storybook sends
 * args across the manager channel with JSON.stringify (story-args.test.ts).
 */
type LoansData = "pages" | "rows" | "long" | "empty" | "loading" | "error";

/** FLOW-962: the offline stories' read, 09:41 Israel time. */
const OFFLINE_SINCE = Date.UTC(2026, 9, 9, 6, 41);

function Tab({ data, closedOpen = false, viewer = false, offline = false }: { data: LoansData; closedOpen?: boolean; viewer?: boolean; offline?: boolean }) {
  const loans: LoansSample["loans"] = data === "pages" ? pagesLoans : data === "rows" ? ROWS : data === "long" ? LONG_ROWS : data === "empty" ? [] : data;
  const screen = (
    <LoansScreen
      sample={{ ...pagesBusiness, loans, loanCurrency: "USD", ...(data === "rows" || data === "pages" ? { summary: LOAN_SUMMARY_SAMPLE } : {}), ...(offline ? { offlineSince: OFFLINE_SINCE } : {}) }}
      closedOpen={closedOpen}
    />
  );
  return (
    <StoryRoute entry="/loans" tabs>
      <ExampleBar />
      {viewer ? <ViewerPreview>{screen}</ViewerPreview> : screen}
    </StoryRoute>
  );
}

function clearHidden() {
  try {
    window.localStorage.removeItem("flow.attention.loans");
  } catch {
    // No storage: nothing to clear.
  }
}

const meta = {
  title: "Screens/Loans",
  parameters: { flowRouter: false },
  component: Tab,
  args: { data: "pages" },
  beforeEach: clearHidden,
} satisfies Meta<typeof Tab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** פעילות: the open loans in groups by kind, under one-line heads. */
export const List: Story = {
  name: "Loans",
  args: { data: "rows" },
};

/** נסגרו: how and when each loan ended. */
export const Closed: Story = {
  name: "Loans, closed",
  args: { data: "rows", closedOpen: true },
  play: async ({ canvasElement }) => {
    const body = storyBody(canvasElement);
    await expect(await body.findByRole("button", { name: /נפרעה/ })).toBeVisible();
  },
};

/** The segment switches between פעילות and נסגרו. */
export const FilterSwitch: Story = {
  name: "Loans, filter",
  args: { data: "rows" },
  play: async ({ canvasElement }) => {
    const radios = within(canvasElement).getAllByRole("radio", { name: /^נסגרו · / });
    await userEvent.click(radios[0] as HTMLElement);
    await expect(radios[0]).toHaveAttribute("aria-checked", "true");
  },
};

/** Scrolled: the band bar slides in and the segment docks into it. */
export const Docked: Story = {
  name: "Loans, docked",
  args: { data: "long" },
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 700, behavior: "instant" });
    await waitFor(() => expect(canvasElement.querySelector(".ui-compact-dock")).toHaveAttribute("data-open"));
  },
};

/** דורש טיפול: the loan waiting for a check and the payment due soon. */
export const Attention: Story = {
  name: "Loans, attention",
  args: { data: "pages" },
};

/** FLOW-1097 (the owner's choice B): at 320 "לבדיקה" with the count, and the loan with when; one line each. */
export const Attention320: Story = {
  name: "Loans, attention, one line at 320",
  args: { data: "pages" },
  globals: { viewport: { value: "flow320", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    await within(canvasElement).findByRole("link", { name: "2 תשלומים ממתינים לבדיקה · משכנתא אלון" });
    // A payment due soon adds its card, as the date the story runs on allows.
    await expect(oneLineAttention(canvasElement).slice(0, 2)).toEqual(["לבדיקה · תשלום אחד", "לבדיקה · 2 תשלומים"]);
  },
};

/** One card hidden: the head offers "1 הוסתרו · הצגה". */
export const AttentionSomeHidden: Story = {
  name: "Loans, attention, one hidden",
  args: { data: "pages" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first] = canvas.getAllByRole("button", { name: /^הסתרה: / });
    await userEvent.click(first as HTMLElement);
    await expect(await canvas.findByRole("button", { name: "1 הוסתרו · הצגה" })).toBeVisible();
  },
};

/** Every card hidden: one line, "אין מה לטפל · הכול נסקר". */
export const AttentionAllHidden: Story = {
  name: "Loans, attention, all hidden",
  args: { data: "pages" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const button of canvas.getAllByRole("button", { name: /^הסתרה: / })) await userEvent.click(button);
    await waitFor(() => expect(canvas.getByText(/אין מה לטפל/)).toBeVisible(), { timeout: 3000 });
  },
};

/** Long names and many rows (V3-States). */
export const LongContent: Story = {
  name: "Loans, long content",
  args: { data: "long" },
};

/** FLOW-962: offline, the list keeps its figures and says which moment they are from. */
export const ListOffline: Story = {
  name: "Offline",
  args: { data: "rows", offline: true },
};

export const Empty: Story = {
  name: "Loans, empty",
  args: { data: "empty" },
};

export const Loading: Story = {
  name: "Loans, loading",
  args: { data: "loading" },
};

export const LoadError: Story = {
  name: "Loans, error",
  args: { data: "error" },
};

export const Viewer: Story = {
  name: "Loans, viewer",
  args: { data: "pages", viewer: true },
};
