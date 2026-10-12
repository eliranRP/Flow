import type { Decorator, Meta, StoryObj } from "@storybook/react";
import { Amount, type AmountPresentation, type AmountSize } from "./amount";
import { padded } from "./story-support";

/** Agorot travel as decimal strings: story args cannot hold a bigint (story-args.test). */
type AmountArgs = {
  agorot: string;
  presentation?: AmountPresentation;
  size: AmountSize;
  direction?: "income" | "expense";
  income?: boolean;
  loss?: boolean;
  cents?: "always";
};

function AmountView({ agorot, ...rest }: AmountArgs) {
  return <Amount agorot={BigInt(agorot)} {...rest} />;
}

const meta = {
  title: "Components/Amount",
  component: AmountView,
  tags: ["autodocs"],
  decorators: [padded],
  args: { agorot: "128450", presentation: "detail", size: "list", cents: "always" },
  argTypes: {
    size: { control: "select", options: ["hero", "display", "total", "card", "list"] },
    presentation: { control: "select", options: ["summary", "detail"] },
    direction: { control: "select", options: [undefined, "income", "expense"] },
    income: { control: "boolean" },
    loss: { control: "boolean" },
    cents: { control: "select", options: [undefined, "always"] },
  },
} satisfies Meta<typeof AmountView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const List: Story = {};
/** Money in: green with a plus (decisions 0120, 0181). */
export const ListIncome: Story = { args: { income: true } };
export const ListExpense: Story = { args: { direction: "expense" } };
export const Detail: Story = { args: { size: "display", presentation: "detail" } };
export const Total: Story = { args: { agorot: "4206900", size: "total", cents: undefined, presentation: "summary" } };
export const Card: Story = { args: { agorot: "4860000", size: "card", cents: undefined, presentation: "summary" } };

const onBand: Decorator = (Story) => (
  <header className="ui-band">
    <div className="ui-band-hero">
      <Story />
    </div>
  </header>
);
/** On the violet band the figure stays white. */
export const Band: Story = { args: { agorot: "-7630000", size: "hero", cents: undefined }, decorators: [onBand] };
export const Loss: Story = { args: { agorot: "-2940000", loss: true, cents: undefined } };
/** Zero carries no sign and no income colour. */
export const Zero: Story = { args: { agorot: "0", income: true } };
