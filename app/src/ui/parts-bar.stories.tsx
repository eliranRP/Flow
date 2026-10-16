import type { Meta, StoryObj } from "@storybook/react";
import { PartsBar } from "./parts-bar";
import { padded } from "./story-support";

const meta = {
  title: "Components/PartsBar",
  component: PartsBar,
  tags: ["autodocs"],
  decorators: [padded],
  args: { label: "שייך", height: 6, gap: 0 },
  argTypes: {
    height: { control: "inline-radio", options: [6, 8] },
    gap: { control: "inline-radio", options: [0, 2] },
  },
} satisfies Meta<typeof PartsBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// Bars take bigint amounts in the app; the stories use plain numbers, which args can carry.
export const SinglePart: Story = {
  args: { parts: [{ key: "paid", value: 42, tone: "accent" }], total: 100, label: "שולם 42%" },
};
export const TwoParts: Story = {
  args: {
    parts: [
      { key: "principal", value: 60, tone: "accent" },
      { key: "interest", value: 25, tone: "accent-dim" },
    ],
    total: 100,
    label: "החזר הלוואה",
    legend: [
      { key: "principal", label: "קרן", value: "60%" },
      { key: "interest", label: "ריבית", value: "25%" },
    ],
  },
};
export const WithGap: Story = { args: { ...TwoParts.args, gap: 2, height: 8 } };
export const Over: Story = {
  args: { parts: [{ key: "spent", value: 130, tone: "signal-soft" }], total: 100, label: "מעל התקציב" },
};
export const NoTotal: Story = {
  args: {
    parts: [
      { key: "a", value: 3, tone: "accent" },
      { key: "b", value: 1, tone: "band-past" },
    ],
    label: "חלוקה",
  },
};
// Home's split card: an 8px bar with a 2px gap and block corners, a loss in the bad tone.
export const HomeSplitLoss: Story = {
  args: {
    parts: [
      { key: "kept", value: 35, tone: "accent" },
      { key: "profit", value: 65, tone: "bad" },
    ],
    height: 8,
    gap: 2,
    radius: "block",
    label: "ממה מורכב המינוס",
  },
};
