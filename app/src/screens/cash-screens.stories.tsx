import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { cashMonthKey } from "../cash";
import { sampleCashLines, sampleCashMonths, sampleQuietCashMonths } from "../dev/cash-sample";
import { at320, dark, exampleOnBand } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { CashLinesScreen, CashMonthScreen } from "./cash-screens";
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
      <CashHome data={sampleCashMonths()} previewing={false} search="" attention={box} example={exampleOnBand} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /^נכנס ב/ })).toBeInTheDocument();
    // FLOW-418: under רווח החודש, the rest of the month's figure with what it holds.
    await expect(canvas.getByRole("link", { name: /^לא נספר ברווח ב/ })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "חודשים קודמים" })).toBeInTheDocument();
  },
};
export const CashHomeMonthDark: Story = { ...CashHomeMonth, name: "Home cash, attention box, dark", ...dark };
export const CashHomeMonth320: Story = { ...CashHomeMonth, name: "Home cash, attention box, 320", ...at320 };

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
};
export const CashMonthDark: Story = { ...CashMonth, name: "Cash, an earlier month, dark", ...dark };

export const CashLinesOut: Story = {
  name: "Cash, the month's יצא",
  render: () => {
    const data = sampleCashMonths();
    return (
      <StoryRoute entry="/" tabs>
        <CashLinesScreen
          sample={{ months: data, lines: sampleCashLines("out") }}
          at={{ month: cashMonthKey(data.months[0]?.month ?? ""), side: "out", currency: "ILS" }}
        />
      </StoryRoute>
    );
  },
};
export const CashLinesOut320: Story = { ...CashLinesOut, name: "Cash, the month's יצא, 320", ...at320 };

/** FLOW-418: the lines behind לא נספר ברווח, money in and out mixed. */
export const CashLinesKept: Story = {
  name: "Cash, the month's לא נספר ברווח",
  render: () => {
    const data = sampleCashMonths();
    return (
      <StoryRoute entry="/" tabs>
        <CashLinesScreen
          sample={{ months: data, lines: sampleCashLines("kept") }}
          at={{ month: cashMonthKey(data.months[0]?.month ?? ""), side: "kept", currency: "ILS" }}
        />
      </StoryRoute>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "לא נספר ברווח" })).toBeInTheDocument();
    await expect(canvas.getByText("כסף שזז בבנק, אבל אינו הכנסה או הוצאה.")).toBeInTheDocument();
  },
};
export const CashLinesKeptDark: Story = { ...CashLinesKept, name: "Cash, the month's לא נספר ברווח, dark", ...dark };
export const CashLinesKept320: Story = { ...CashLinesKept, name: "Cash, the month's לא נספר ברווח, 320", ...at320 };
