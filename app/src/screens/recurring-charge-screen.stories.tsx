import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { longHebrew } from "../ui/story-support";
import { RECURRING_CHARGES_FIXTURE_POWER, RECURRING_CHARGES_FIXTURE_WATER, RECURRING_MISSING_FIXTURE } from "../recurring-sample";
import { Route, Routes } from "react-router-dom";
import { StoryRoute } from "../ui/story-route";
import { ChargeError, ChargeMissing, RecurringChargeScreen } from "./recurring-charge-screen";

/** FLOW-447c: the charge page on the board's two parties, as the page's states. Invented names only. */
const NOW = new Date("2026-10-11T12:00:00Z");

function Demo({ state }: { state: "item" | "late" | "ignored" | "pace" | "amount" | "owner" | "missing" | "error" | "offline" | "pick" | "long" | "loading" | "history" }) {
  const entry = state === "late" || state === "ignored" ? "/recurring/expense/power" : state === "loading" ? "/recurring/expense/water?preview=loading" : "/recurring/expense/water";
  return (
    <StoryRoute entry={entry}>
      {state === "loading" ? (
        <Routes>
          <Route path="/recurring/:direction/:partyId" element={<RecurringChargeScreen now={NOW} />} />
        </Routes>
      ) : null}
      {state === "history" ? <RecurringChargeScreen now={NOW} sample={{ ...RECURRING_CHARGES_FIXTURE_WATER, charges: null, chargesLoading: true }} /> : null}
      {state === "missing" ? <ChargeMissing /> : null}
      {state === "error" ? <ChargeError /> : null}
      {state === "item" ? <RecurringChargeScreen now={NOW} sample={RECURRING_CHARGES_FIXTURE_WATER} /> : null}
      {state === "pick" ? (
        <RecurringChargeScreen
          now={NOW}
          sample={{ ...RECURRING_CHARGES_FIXTURE_WATER, picks: {
            projects: [{ id: "p-elm-row", name: "Elm Row" }, { id: "p-cedar", name: "Cedar St" }, { id: "p-birch", name: "Birch Lane" }],
            categories: [{ id: "c-water", name: "חשמל ומים" }, { id: "c-repair", name: "אחזקה" }],
          } }}
        />
      ) : null}
      {state === "offline" ? <RecurringChargeScreen now={NOW} sample={{ ...RECURRING_CHARGES_FIXTURE_WATER, offlineSince: Date.parse("2026-10-11T06:41:00Z") }} /> : null}
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
      {state === "long" ? <RecurringChargeScreen now={NOW} sample={{ ...RECURRING_CHARGES_FIXTURE_POWER, row: { ...RECURRING_CHARGES_FIXTURE_POWER.row, party_name: `Brightline Power ${longHebrew}` } }} /> : null}
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

/** FLOW-1139: while the schedule loads: the detail page's shape under Back, not list rows. */
export const Loading: Story = {
  args: { state: "loading" },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("טוען…")).toHaveAttribute("role", "status");
    await expect(canvasElement.querySelector(".ui-charge-body .ui-skel-detail-head")).not.toBeNull();
    await expect(canvasElement.querySelector(".ui-skel-row")).toBeNull();
  },
};

/** FLOW-1139: the page is in, its charges still load: the history's place is held by its skeleton (bars and rows). */
export const HistoryLoading: Story = {
  args: { state: "history" },
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(canvasElement.querySelectorAll(".ui-charge-history-skel-bar")).toHaveLength(6);
    });
  },
};

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

/** FLOW-963: the schedule read failed: what happened, נסו שוב and צריך עזרה?. */
export const Failed: Story = { args: { state: "error" } };

/** FLOW-963: the project picker open over the item page; a pick moves every payment of the charge. */
export const ProjectPicker: Story = {
  args: { state: "pick" },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    (await body.findByRole("button", { name: "פרויקט Elm Row" })).click();
    await body.findByRole("radio", { name: "Cedar St" });
  },
};

/** FLOW-963: offline, the line under the head says which moment the figures are from. */
export const Offline: Story = { args: { state: "offline" } };

/** A long name wraps in the head (V3-States). */
export const LongContent: Story = { args: { state: "long" } };

/** FLOW-1048: scrolled past the head, the 56px detail bar slides in with the name and the figure. */
export const Scrolled: Story = {
  args: { state: "late" },
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 600, behavior: "instant" });
    await waitFor(() => expect(canvasElement.querySelector(".ui-compact-bar-detail")).toHaveAttribute("aria-hidden", "false"));
  },
};
