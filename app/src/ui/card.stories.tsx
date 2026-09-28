import type { Meta, StoryObj } from "@storybook/react";
import { Card, Section } from "./card";
import { longHebrew, padded } from "./story-support";

const meta = {
  title: "Components/Card",
  component: Card,
  decorators: [padded],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: <p className="t-label">הרווח לפני מע״מ</p> },
};
export const SectionBlock: Story = {
  args: { children: null },
  render: () => (
    <Section title="פרויקטים">
      <p className="t-label">{longHebrew}</p>
    </Section>
  ),
};
export const LongHebrew: Story = {
  args: { children: <p className="t-label">{longHebrew}</p> },
};
