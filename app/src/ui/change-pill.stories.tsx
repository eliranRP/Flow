import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { ChangePill } from "./change-pill";
import { padded } from "./story-support";

/** On the band the pill sits on the violet band, as on Home. */
const onBand: Decorator = (Story) => (
  <div className="ui-band flex w-full min-w-0 flex-col items-stretch gap-4 p-4">
    <Story />
  </div>
);

const meta = {
  title: "Components/ChangePill",
  component: ChangePill,
  tags: ["autodocs"],
  decorators: [padded],
  args: { percent: -10, comparison: "מחודש שעבר", onBand: false, upHurts: false },
  argTypes: {
    percent: { control: "number" },
    comparison: { control: "text" },
    onBand: { control: "boolean" },
    upHurts: { control: "boolean" },
  },
} satisfies Meta<typeof ChangePill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Helps: Story = { args: { percent: 12 } };
export const Hurts: Story = { args: { percent: -10 } };
export const OnBandHelps: Story = { args: { percent: 12, onBand: true }, decorators: [onBand] };
