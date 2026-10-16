import type { Meta, StoryObj } from "@storybook/react";
import { GroupHead } from "./group-head";
import { padded } from "./story-support";

const meta = {
  title: "Components/GroupHead",
  component: GroupHead,
  tags: ["autodocs"],
  decorators: [padded],
  args: { id: "group-head-story", title: "שויכו היום", count: "3 תנועות" },
} satisfies Meta<typeof GroupHead>;

export default meta;
type Story = StoryObj<typeof meta>;

const SUM = <span className="ui-month-line t-amount">₪1,250.00</span>;

export const WithSums: Story = {
  args: { children: SUM },
};
export const LongName: Story = {
  args: { title: "פרויקט שיפוץ המטבח והחשמל בדירה ברחוב הרצל", children: SUM },
};
