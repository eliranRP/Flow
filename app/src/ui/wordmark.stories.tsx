import type { Meta, StoryObj } from "@storybook/react";
import { padded } from "./story-support";
import { Wordmark } from "./wordmark";

const meta = {
  title: "Components/Wordmark",
  component: Wordmark,
  decorators: [padded],
} satisfies Meta<typeof Wordmark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Logo: Story = { args: { tone: "logo", size: "band" } };
export const OnBand: Story = {
  args: { tone: "on-band", size: "band" },
  decorators: [
    (Story) => (
      <div className="band p-4">
        <Story />
      </div>
    ),
  ],
};
export const SignIn: Story = { args: { tone: "logo", size: "signin" } };
