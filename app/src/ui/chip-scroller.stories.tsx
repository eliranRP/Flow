import type { Meta, StoryObj } from "@storybook/react";
import { Chip } from "./chip";
import { ChipScroller } from "./chip-scroller";
import { at320, dark } from "./screen-stories-support";

function Row() {
  return (
    <ChipScroller label="סינון" className="ui-search-chips">
      <Chip pressed onClick={() => undefined}>תקופה</Chip>
      <Chip onClick={() => undefined}>הוצאות</Chip>
      <Chip onClick={() => undefined}>הכנסות</Chip>
      <Chip onClick={() => undefined}>פרויקט</Chip>
      <Chip onClick={() => undefined}>קטגוריה</Chip>
      <Chip onClick={() => undefined}>לאישור</Chip>
    </ChipScroller>
  );
}

/** FLOW-347: the end of the row fades while chips wait past it. */
const meta = {
  title: "Components/ChipScroller",
  render: () => <Row />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Default320: Story = { ...at320 };
export const DefaultDark320: Story = { ...at320, ...dark };
