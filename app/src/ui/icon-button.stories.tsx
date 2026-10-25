import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";
import { padded } from "./story-support";

const meta = {
  title: "Components/IconButton",
  component: IconButton,
  decorators: [padded],
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  tags: ["clip-no-text"],
  args: { label: "סגירה", children: <CloseIcon /> },
};
export const Disabled: Story = {
  tags: ["clip-no-text"],
  args: { label: "סגירה", disabled: true, children: <CloseIcon /> },
};
