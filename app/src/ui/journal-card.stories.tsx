import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { JournalCard, type JournalRow } from "./journal-card";
import { padded } from "./story-support";

/** Invented legs: a plain cost, and a mortgage payment with two legs kept out of profit. */
const bank = (amount: bigint): JournalRow => ({ key: "bank", name: "Example Checking ••1234", type: "בנק", project: null, amount, keptOut: false });
const plainDebit: JournalRow[] = [{ key: "1", name: "קבלני משנה", type: "הוצאה", project: "פרויקט הרצליה", amount: 240_000n, keptOut: false }];
const loanDebit: JournalRow[] = [
  { key: "1", name: "ריבית משכנתא", type: "הוצאה", project: "פרויקט רעננה", amount: 140_000n, keptOut: false },
  { key: "2", name: "אסקרו", type: "נכס", project: "פרויקט רעננה", amount: 60_000n, keptOut: true },
  { key: "3", name: "קרן הלוואה", type: "התחייבות", project: "פרויקט רעננה", amount: 35_000n, keptOut: true },
];

/** Storybook args hold no bigint, so each story renders its own legs. */
const meta = {
  title: "Components/JournalCard",
  component: JournalCard,
  decorators: [padded],
} satisfies Meta<typeof JournalCard>;

export default meta;
type Story = StoryObj;

/** A plain line: only the quiet "פקודת יומן ▾" link, closed. */
export const Collapsed: Story = {
  render: () => <JournalCard debit={plainDebit} credit={[bank(240_000n)]} currency="USD" balanced collapsible />,
};

/** The link opens the entry in place: חובה then זכות, and the balanced footer. */
export const Opened: Story = {
  render: () => <JournalCard debit={plainDebit} credit={[bank(240_000n)]} currency="USD" balanced collapsible />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /פקודת יומן/ }));
    await within(canvasElement).findByRole("region", { name: "פקודת יומן" });
  },
};

/** Legs outside the P&L: the card shows open with its book, the kept-out legs faded with the eye-off mark. */
export const KeptOutLegs: Story = {
  render: () => <JournalCard debit={loanDebit} credit={[bank(235_000n)]} currency="USD" balanced />,
};

/** Booked by Jev through the MCP: the "✦ נרשם ע״י Jev" badge in the head. */
export const BookedByJev: Story = {
  render: () => <JournalCard debit={loanDebit} credit={[bank(235_000n)]} currency="USD" balanced bookedByAi />,
};

/** A plain line Jev booked, opened. */
export const BookedByJevOpen: Story = {
  render: () => <JournalCard debit={plainDebit} credit={[bank(240_000n)]} currency="USD" balanced bookedByAi collapsible initialOpen />,
};

/** The legs don't add up (the server refuses this, so only a broken read shows it): the footer says so. */
export const Unbalanced: Story = {
  render: () => <JournalCard debit={plainDebit} credit={[bank(230_000n)]} currency="USD" balanced={false} initialOpen />,
};

/** FLOW-955: an owner or editor gets "עריכה ›" at the footer's end, to the composer. */
export const WithEdit: Story = {
  render: () => <JournalCard debit={loanDebit} credit={[bank(235_000n)]} currency="USD" balanced editTo="/transactions/t1/journal" />,
};

/** FLOW-955: the review card's compact entry, "הפקודה שהוצעה", with עריכה in its head. */
export const Proposed: Story = {
  render: () => <JournalCard debit={loanDebit} credit={[bank(235_000n)]} currency="USD" balanced proposed editTo="/transactions/t1/journal" />,
};
