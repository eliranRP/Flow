import type { Meta, StoryObj } from "@storybook/react";
import type { ComponentProps } from "react";
import { useRef, useState } from "react";
import { LoanSplitPanel } from "./loan-match";

/** FLOW-107. Invented amounts: a 2,450.00 payment split 1,050 / 400 / 1,000. */
const PARTS = [
  { id: "a", part: "interest", amountMinor: 105_000n, scheduledMinor: 105_000n, needsReview: false, loanId: "loan-1", inPnl: true },
  { id: "b", part: "escrow", amountMinor: 40_000n, scheduledMinor: 40_000n, needsReview: false, loanId: "loan-1", inPnl: true },
  { id: "c", part: "principal", amountMinor: 100_000n, scheduledMinor: 100_000n, needsReview: false, loanId: "loan-1", inPnl: false },
] as const;

const WHOLE_LINE = PARTS.map((part) => ({ ...part, inPnl: null }));
const FLAGGED = PARTS.map((part) => ({ ...part, inPnl: null, needsReview: true }));

/** Args stay plain JSON: Storybook cannot serialise bigint amounts, so stories pick parts by name. */
type PanelArgs = Partial<Omit<ComponentProps<typeof LoanSplitPanel>, "parts">> & { split?: "parts" | "whole" | "flagged" };

const SPLITS = { parts: PARTS, whole: WHOLE_LINE, flagged: FLAGGED };

function Panel({ split = "parts", ...props }: PanelArgs) {
  const [open, setOpen] = useState(false);
  const splitSectionRef = useRef<HTMLHeadingElement>(null);
  return (
    <div>
      <LoanSplitPanel
        offerMatch={false}
        lineCurrency="USD"
        displayCurrency="USD"
        parts={SPLITS[split]}
        byParts
        loans={[]}
        needsReview={false}
        currencyMismatch={false}
        busy={false}
        sheetOpen={open}
        onSheetOpenChange={setOpen}
        splitSectionRef={splitSectionRef}
        onMatch={() => undefined}
        onCorrect={() => undefined}
        {...props}
      />
    </div>
  );
}

const meta = {
  title: "Screens/Loan split",
  component: Panel,
} satisfies Meta<typeof Panel>;

export default meta;
type Story = StoryObj<typeof meta>;

const light390 = { parameters: { viewport: { defaultViewport: "flow390" } } };
const dark390 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow390" } } };
const light320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const dark320 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } };

export const ByParts: Story = { ...light390 };
export const ByPartsDark: Story = { ...dark390 };
export const ByParts320: Story = { ...light320 };
export const ByPartsDark320: Story = { ...dark320 };

/** A shekel loan: agorot hide when they are zero. */
export const Shekels: Story = { args: { lineCurrency: "ILS", displayCurrency: "ILS" }, ...light390 };

/** A part waits for review, so the whole line counts and the correction shows. */
export const NeedsReview: Story = { args: { split: "flagged", byParts: false, needsReview: true }, ...light390 };
export const NeedsReviewDark320: Story = { args: { split: "flagged", byParts: false, needsReview: true }, ...dark320 };

/** A line with VAT keeps its parts on screen but counts as one line. */
export const WholeLine: Story = { args: { split: "whole", byParts: false }, ...light390 };

export const CurrencyMismatch: Story = {
  args: { split: "flagged", byParts: false, needsReview: true, currencyMismatch: true },
  ...light390,
};

export const Viewer: Story = { args: { readOnly: true }, ...light390 };
export const ViewerNeedsReview: Story = {
  args: { split: "flagged", byParts: false, needsReview: true, readOnly: true },
  ...light390,
};
