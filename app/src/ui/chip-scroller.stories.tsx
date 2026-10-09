import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
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

/** FLOW-351: scrolled to the middle, both edges fade, so the chips off screen on each side read as more. */
const scrolledPlay: Story["play"] = async ({ canvasElement }) => {
  const row = canvasElement.querySelector<HTMLElement>(".ui-chip-scroller");
  await expect(row).not.toBeNull();
  if (!row) return;
  row.scrollLeft = -(row.scrollWidth - row.clientWidth) / 2;
  await waitFor(() => expect(row).toHaveAttribute("data-more", "both"));
};
/** The story runner ignores the viewport, so the row sits in a phone-wide box of its own. */
const narrow: Story["decorators"] = [(Story) => <div style={{ inlineSize: 288 }}><Story /></div>];
export const Scrolled320: Story = { ...at320, decorators: narrow, play: scrolledPlay };
export const ScrolledDark320: Story = { ...at320, ...dark, decorators: narrow, play: scrolledPlay };
