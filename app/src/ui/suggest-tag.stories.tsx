import type { Meta, StoryObj } from "@storybook/react";
import { JevTag, ReversalTag, SuggestTag } from "./suggest-tag";
import { padded } from "./story-support";

/** The marks a suggested line carries. הצעת Jev marks a value Jev, the AI tagger, filled. */
function Tags() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <JevTag />
      <SuggestTag />
      <ReversalTag />
    </div>
  );
}

const meta = {
  title: "Components/SuggestTag",
  component: Tags,
  decorators: [padded],
} satisfies Meta<typeof Tags>;

export default meta;
type Story = StoryObj<typeof meta>;

export const All: Story = {};
export const AllDark: Story = { globals: { theme: "dark" } };
export const All320: Story = { parameters: { viewport: { defaultViewport: "flow320" } } };
export const Jev: Story = { render: () => <JevTag /> };
