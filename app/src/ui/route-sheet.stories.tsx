import type { Meta, StoryObj } from "@storybook/react";
import { RouteSheet } from "./route-sheet";
import { longHebrew, padded } from "./story-support";
import { TextField } from "./text-field";

const meta = {
  title: "Components/RouteSheet",
  component: RouteSheet,
  decorators: [padded],
} satisfies Meta<typeof RouteSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "הוספה",
    closeTo: "/",
    hint: "קבלה, חשבונית, או הוצאה.",
    children: <TextField label="תיאור" placeholder="למשל חומרים" />,
  },
};
export const Empty: Story = {
  args: { title: "הוספה", closeTo: "/", children: null },
};
export const LongHebrew: Story = {
  args: {
    title: longHebrew,
    closeTo: "/",
    hint: longHebrew,
    children: <TextField label={longHebrew} defaultValue={longHebrew} />,
  },
};
