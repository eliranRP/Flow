import type { Meta, StoryObj } from "@storybook/react";
import { longHebrew, padded } from "./story-support";
import { TextLink } from "./text-link";

const meta = {
  title: "Components/TextLink",
  component: TextLink,
  decorators: [padded],
} satisfies Meta<typeof TextLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AsButton: Story = {
  args: { children: "עוד פריטים" },
  render: (args) => <TextLink onClick={() => undefined}>{args.children}</TextLink>,
};
export const Route: Story = { args: { to: "/sign-in", children: "חזרה" } };
export const Mail: Story = { args: { href: "mailto:ops@nromomentum.com", children: "ops@nromomentum.com" } };
export const LongHebrew: Story = { args: { to: "/help", children: longHebrew } };
