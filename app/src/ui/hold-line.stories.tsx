import type { Meta, StoryObj } from "@storybook/react";
import { HoldLine } from "./hold-line";
import { padded } from "./story-support";

const meta = {
  title: "Components/HoldLine",
  component: HoldLine,
  decorators: [padded],
} satisfies Meta<typeof HoldLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Category: Story = {
  args: {
    children: "בחרו קטגוריה.",
    onDiscard: () => undefined,
  },
};

export const Split: Story = {
  args: {
    children: "בחרו לפחות 2 פרויקטים",
    onDiscard: () => undefined,
  },
};
