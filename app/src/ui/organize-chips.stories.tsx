import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import { Chip } from "./chip";
import { OrganizeChips } from "./organize-chips";
import { at320 } from "./screen-stories-support";

function Row() {
  return (
    <OrganizeChips label="סינון" className="ui-search-chips">
      <Chip pressed onClick={() => undefined}>לפי תאריך</Chip>
      <Chip onClick={() => undefined}>לפי סכום</Chip>
      <Chip onClick={() => undefined}>לפי פרויקט</Chip>
      <Chip onClick={() => undefined}>לפי קטגוריה</Chip>
    </OrganizeChips>
  );
}

/** FLOW-347: the end of the row fades while chips wait past it. */
const meta = {
  title: "Components/OrganizeChips",
  render: () => <Row />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** FLOW-351: scrolled to the middle, both edges fade, so the chips off screen on each side read as more. */
const scrolledPlay: Story["play"] = async ({ canvasElement }) => {
  const row = canvasElement.querySelector<HTMLElement>(".ui-organize-chips");
  await expect(row).not.toBeNull();
  if (!row) return;
  row.scrollLeft = -(row.scrollWidth - row.clientWidth) / 2;
  await waitFor(() => expect(row).toHaveAttribute("data-more", "both"));
};
/** The story runner ignores the viewport, so the row sits in a phone-wide box of its own. */
const narrow: Story["decorators"] = [(Story) => <div style={{ inlineSize: 288 }}><Story /></div>];
export const Scrolled: Story = { ...at320, decorators: narrow, play: scrolledPlay };
