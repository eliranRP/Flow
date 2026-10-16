import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { cashMonthKey } from "../cash";
import { sampleCashMonths, sampleQuietCashMonths } from "../dev/cash-sample";
import { exampleOnBand } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { CashMonthScreen } from "./cash-screens";
import { attentionRows, CashHome } from "./HomeScreen";

/** FLOW-413 (frame b): Home's cash, an earlier month's page, and a month's lines. Invented figures. */

const meta = {
  title: "Screens/Cash",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const box = attentionRows({ pending: 7, unpaidCount: 3, unpaidGross: 460_000n, search: "" });

export const CashHomeMonth: Story = {
  name: "Home cash, attention box",
  render: () => (
    <StoryRoute entry="/" tabs>
      <CashHome data={sampleCashMonths()} previewing={false} search="" attention={box} example={exampleOnBand} recurringTo="/missing-bills" />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /^נכנס ב/ })).toBeInTheDocument();
    // FLOW-418: under רווח החודש, the rest of the month's figure with what it holds.
    await expect(canvas.getByRole("link", { name: /^לא נספר ברווח ב/ })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "חודשים קודמים" })).toBeInTheDocument();
    // FLOW-417: the whole history opens from under the last month.
    await expect(canvas.getByRole("link", { name: "לכל החודשים" })).toHaveAttribute("href", "/cash/history");
    // FLOW-423: קבועים stays one tap away with no alert in the box.
    await expect(canvas.getByRole("link", { name: "לכל הקבועים" })).toHaveAttribute("href", "/missing-bills");
  },
};

export const CashHomeNoBox: Story = {
  name: "Home cash, nothing waiting",
  render: () => (
    <StoryRoute entry="/" tabs>
      <CashHome data={sampleCashMonths()} previewing={false} search="" attention={[]} example={exampleOnBand} />
    </StoryRoute>
  ),
};

export const CashHomeQuiet: Story = {
  name: "Home cash, nothing moved yet this month",
  render: () => (
    <StoryRoute entry="/" tabs>
      <CashHome data={sampleQuietCashMonths()} previewing={false} search="" attention={[]} example={exampleOnBand} />
    </StoryRoute>
  ),
};

export const CashMonth: Story = {
  name: "Cash, an earlier month",
  render: () => {
    const data = sampleCashMonths();
    return (
      <StoryRoute entry="/" tabs>
        <CashMonthScreen sample={data} monthKey={cashMonthKey(data.months[1]?.month ?? "")} />
      </StoryRoute>
    );
  },
  play: async ({ canvasElement }) => {
    // FLOW-362: an earlier month's profit row names its month, not "רווח החודש".
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/^רווח ב/)).toBeInTheDocument();
    await expect(canvas.queryByText("רווח החודש")).not.toBeInTheDocument();
    // FLOW-362 (C15-6): earlier and later chevrons by the title.
    await expect(canvas.getAllByRole("button", { name: /^תזרים / })).toHaveLength(2);
  },
};

export const CashMonthCurrent: Story = {
  name: "Cash, this month (no later chevron)",
  render: () => {
    const data = sampleCashMonths();
    return (
      <StoryRoute entry="/" tabs>
        <CashMonthScreen sample={data} monthKey={cashMonthKey(data.months[0]?.month ?? "")} />
      </StoryRoute>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button", { name: /^תזרים / })).toHaveLength(1);
  },
};
