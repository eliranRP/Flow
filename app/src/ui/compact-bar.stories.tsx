import type { Meta, StoryObj } from "@storybook/react";
import { Amount } from "./amount";
import { Chip } from "./chip";
import { CompactBar } from "./compact-bar";
import { OrganizeChips } from "./organize-chips";
import { longHebrew } from "./story-support";

// Amounts are bigint, so the figure stays in render: story args go through JSON.

const meta = {
  title: "Components/CompactBar",
  component: CompactBar,
  tags: ["autodocs"],
  args: { title: "שויכו היום", backTo: "/review", shown: true, size: "list" },
  argTypes: {
    size: { control: "select", options: ["list", "detail"] },
    shown: { control: "boolean" },
  },
} satisfies Meta<typeof CompactBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A list page: Back (icon), the title, 44px. Invented rows. */
export const List: Story = {};

/** The parent's name as Back's label, "‹ הגדרות" (decision 0156). */
export const ListWithFigure: Story = {
  args: {
    title: "קטגוריות",
    label: "הגדרות",
    backTo: "/settings",
  },
  render: (args) => <CompactBar {...args} figure={<Amount agorot={125_000n} size="list" />} />,
};

/** A detail page: 56px. */
export const Detail: Story = {
  args: { title: "שיפוץ הרצל 12", label: "פרויקטים", backTo: "/projects", size: "detail" },
  render: (args) => <CompactBar {...args} figure={<Amount agorot={2_940_000n} size="list" />} />,
};

/** FLOW-363 (3c): the organize chips ride under the bar, so they stay one tap away once the page scrolls. */
export const Panel: Story = {
  args: { title: "יצא", label: "בית", backTo: "/" },
  render: (args) => (
    <CompactBar
      {...args}
      figure={<Amount agorot={125_000n} size="list" />}
      panel={
        <OrganizeChips label="סידור">
          <Chip kind="choice" pressed>לפי תאריך</Chip>
          <Chip kind="choice">לפי סכום</Chip>
          <Chip kind="choice">לפי פרויקט</Chip>
          <Chip kind="choice">לפי קטגוריה</Chip>
        </OrganizeChips>
      }
    />
  ),
};

/** Hidden from the start: no slide, no focus, no clicks. */
export const Hidden: Story = { args: { shown: false }, tags: ["clip-no-text"] };

export const LongHebrew: Story = {
  args: { title: longHebrew, label: longHebrew, backTo: "/projects" },
  render: (args) => <CompactBar {...args} figure={<Amount agorot={125_000n} size="list" />} />,
};
