import type { Meta, StoryObj } from "@storybook/react";
import { BigNumber, Money, type AmountPresentation } from "./big-number";
import { largeAgorot, padded } from "./story-support";

/** Agorot travel as decimal strings. The manager JSON.stringifies args, and a bigint blanks it. */
type AmountArgs = {
  agorot: string;
  presentation?: AmountPresentation;
  size?: "hero" | "display" | "list";
  loss?: boolean;
};

function AmountView({ agorot, presentation, size, loss }: AmountArgs) {
  return <BigNumber agorot={BigInt(agorot)} presentation={presentation} size={size} loss={loss} />;
}

const meta = {
  title: "Components/BigNumber",
  component: AmountView,
  decorators: [padded],
} satisfies Meta<typeof AmountView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Summary: Story = { args: { agorot: "-7630000", size: "hero" } };

/** On the violet band the figure stays white. Hero names a loss with הפסד. */
export const OnBand: Story = {
  args: { agorot: "-7630000", size: "hero" },
  render: ({ agorot }) => (
    <header className="ui-band">
      <div className="ui-band-hero">
        <h1 className="ui-hero-figure">
          <BigNumber agorot={BigInt(agorot)} size="hero" />
        </h1>
      </div>
    </header>
  ),
};
export const DetailAgorot: Story = { args: { agorot: "-10050", presentation: "detail", size: "display" } };
export const Loss: Story = { args: { agorot: "-2940000", loss: true, size: "list" } };
export const LargeAmount: Story = { args: { agorot: String(largeAgorot), size: "hero" } };
export const Inline: Story = {
  args: { agorot: "47200000" },
  render: () => <Money agorot={47_200_000n} />,
};

export const UsdExpense: Story = {
  args: { agorot: "125000", size: "list" },
  render: () => <BigNumber agorot={125_000n} currency="USD" direction="expense" size="list" />,
};

/** Money in is green with no plus (decision 0114); a transaction row adds small cents, ".00" included. */
export const Income: Story = {
  args: { agorot: "350000", size: "list" },
  render: ({ agorot }) => <BigNumber agorot={BigInt(agorot)} size="list" direction="income" income />,
};
export const IncomeRowCents: Story = {
  args: { agorot: "350000", size: "list" },
  render: ({ agorot }) => <BigNumber agorot={BigInt(agorot)} size="list" direction="income" income cents="always" />,
};
