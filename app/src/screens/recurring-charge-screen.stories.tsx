import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";
import { RECURRING_CHARGES_FIXTURE_POWER, RECURRING_CHARGES_FIXTURE_WATER, RECURRING_MISSING_FIXTURE } from "../recurring-sample";
import { StoryRoute } from "../ui/story-route";
import { ChargeError, ChargeMissing, RecurringChargeScreen } from "./recurring-charge-screen";

/** FLOW-447c: the charge page on the board's two parties, as the page's states. Invented names only. */
const NOW = new Date("2026-10-11T12:00:00Z");

function Demo({ state }: { state: "item" | "late" | "ignored" | "pace" | "amount" | "owner" | "missing" | "error" }) {
  const entry = state === "late" || state === "ignored" ? "/recurring/expense/power" : "/recurring/expense/water";
  return (
    <StoryRoute entry={entry}>
      {state === "missing" ? <ChargeMissing /> : null}
      {state === "error" ? <ChargeError /> : null}
      {state === "item" ? <RecurringChargeScreen now={NOW} sample={RECURRING_CHARGES_FIXTURE_WATER} /> : null}
      {state === "pace" ? <RecurringChargeScreen now={NOW} sample={RECURRING_CHARGES_FIXTURE_WATER} openSheet="pace" /> : null}
      {state === "amount" ? <RecurringChargeScreen now={NOW} sample={RECURRING_CHARGES_FIXTURE_WATER} openSheet="amount" /> : null}
      {state === "owner" ? (
        <RecurringChargeScreen
          now={NOW}
          sample={{ ...RECURRING_CHARGES_FIXTURE_WATER, row: { ...RECURRING_CHARGES_FIXTURE_WATER.row, typical_amount_minor: -17000, typical_amount_source: "owner" } }}
          openSheet="amount"
        />
      ) : null}
      {state === "late" ? <RecurringChargeScreen now={NOW} sample={RECURRING_CHARGES_FIXTURE_POWER} /> : null}
      {state === "ignored" ? (
        <RecurringChargeScreen now={NOW} sample={{ ...RECURRING_CHARGES_FIXTURE_POWER, bills: RECURRING_MISSING_FIXTURE.filter((bill) => bill.party_id !== "power") }} />
      ) : null}
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/RecurringCharge",
  component: Demo,
  parameters: { flowRouter: false, viewport: { defaultViewport: "flow390-short" } },
  tags: ["autodocs"],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The arrived bill, 38% over: the banner with its התעלמות, the history, the recurring row. */
export const Item: Story = { args: { state: "item" } };

/** The late bill with its suggested match: the match box between the banner and the rows. */
export const Late: Story = { args: { state: "late" } };

/** The pace sheet open over the item page. */
export const PaceSheetOpen: Story = {
  args: { state: "pace" },
  play: async ({ canvasElement }) => {
    // The sheet draws in a portal on the body, outside the story's canvas.
    await within(canvasElement.ownerDocument.body).findByRole("radio", { name: "כל חודש" });
  },
};

/** Decision 0189: the usual amount sheet open over the item page, with Flow's own amount. */
export const UsualAmountSheetOpen: Story = {
  args: { state: "amount" },
  play: async ({ canvasElement }) => {
    await within(canvasElement.ownerDocument.body).findByRole("textbox", { name: "הסכום הרגיל" });
  },
};

/** The usual amount the owner set: "קבעת" on the row, and "חזרה לחישוב" in its sheet. */
export const UsualAmountOwner: Story = {
  args: { state: "owner" },
  play: async ({ canvasElement }) => {
    await within(canvasElement.ownerDocument.body).findByRole("button", { name: "חזרה לחישוב" });
  },
};

/** A party with no recurring row: the not-found view. */
export const Missing: Story = { args: { state: "missing" } };
