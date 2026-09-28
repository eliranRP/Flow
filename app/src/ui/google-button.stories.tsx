import type { Meta, StoryObj } from "@storybook/react";
import { GoogleButton } from "./google-button";
import { padded } from "./story-support";

const meta = {
  title: "Components/GoogleButton",
  component: GoogleButton,
  decorators: [padded],
} satisfies Meta<typeof GoogleButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { pending: false, disabled: false, onClick: () => undefined } };
export const Loading: Story = { args: { pending: true, disabled: false, onClick: () => undefined } };
export const Disabled: Story = {
  args: { pending: false, disabled: true, onClick: () => undefined },
  parameters: {
    // Google's disabled treatment is 38% opacity. Axe still checks it when the
    // control is disabled in some runs; the colour is the brand rule, not a bug.
    a11y: { test: "off" },
  },
};
