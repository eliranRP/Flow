import type { Meta, StoryObj } from "@storybook/react";
import { Amount } from "./amount";
import { CompactBar } from "./compact-bar";
import { longHebrew } from "./story-support";

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
    figure: <Amount agorot={125_000n} size="list" />,
  },
};

/** A detail page: 56px. */
export const Detail: Story = {
  args: { title: "שיפוץ הרצל 12", label: "פרויקטים", backTo: "/projects", size: "detail", figure: <Amount agorot={2_940_000n} size="list" /> },
};

/** Hidden from the start: no slide, no focus, no clicks. */
export const Hidden: Story = { args: { shown: false } };

export const LongHebrew: Story = {
  args: { title: longHebrew, label: longHebrew, backTo: "/projects", figure: <Amount agorot={125_000n} size="list" /> },
};
