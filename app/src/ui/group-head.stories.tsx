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

// The sum as a month total line draws it: its income after the count, with the agorot raised.
const SUM = (
  <span className="ui-month-line">
    <span>
      <span className="sr-only">, הכנסות </span>
      <bdi dir="ltr" className="ui-num ui-income">+₪1,250<span className="ui-num-cents">.50</span></bdi>
    </span>
  </span>
);

export const WithSums: Story = {
  args: { children: SUM },
};
export const LongName: Story = {
  args: { title: "פרויקט שיפוץ המטבח והחשמל בדירה ברחוב הרצל", children: SUM },
};
