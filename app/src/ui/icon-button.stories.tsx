import type { Meta, StoryObj } from "@storybook/react";
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
  parameters: { clipCheck: { noText: true } },
  args: { label: "סגירה", children: <CloseIcon /> },
};
export const Disabled: Story = {
  tags: ["clip-no-text"],
  parameters: { clipCheck: { noText: true } },
  args: { label: "סגירה", disabled: true, children: <CloseIcon /> },
};
export const OnBand: Story = {
  tags: ["clip-no-text"],
  parameters: { clipCheck: { noText: true } },
  args: { label: "סגירה", onBand: true, children: <CloseIcon /> },
  decorators: [
    (Story) => (
      <div className="ui-band p-4">
        <Story />
      </div>
    ),
  ],
};
