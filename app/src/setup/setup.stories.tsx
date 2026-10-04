import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import { TagIcon } from "../ui/icons";
import { longHebrew } from "../ui/story-support";
import { JEV_HINT } from "./copy";
import { SetupStep } from "./shell";

const meta = {
  title: "Screens/Setup",
  component: SetupStep,
} satisfies Meta<typeof SetupStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SmartTag: Story = {
  args: {
    step: 2,
    title: "תיוג חכם",
    line: "Flow יציע פרויקט וקטגוריה לכל תנועה.",
    demo: "jev",
  },
  render: (args) => (
    <SetupStep
      {...args}
      onBack={() => undefined}
      onSkip={() => undefined}
      primary={<Button type="button" full>המשך</Button>}
    >
      <Toggle
        icon={<TagIcon size={24} />}
        label="תיוג חכם (Jev)"
        hint={`${JEV_HINT} ${longHebrew}`}
        checked
        onChange={() => undefined}
      />
    </SetupStep>
  ),
};
