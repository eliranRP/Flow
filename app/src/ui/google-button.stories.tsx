import type { Meta, StoryObj } from "@storybook/react-vite";
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
