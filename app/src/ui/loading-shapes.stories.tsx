import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { ChipsSkeleton, FormSkeleton, GroupedSkeleton, RadioRowsSkeleton, TileMenuSkeleton } from "./loading-shapes";
import { Sheet } from "./sheet";

/**
 * FLOW-1137: the loading states in the content's own shape. Each screen's story shows its own in place; these
 * show each shape alone, and the + sheet's, which shows only while the user's role loads.
 */
const meta = {
  title: "Components/Loading shapes",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The journal composer's and the line split's form: the line's figure, then a label over a control per field. */
export const Form: Story = {
  render: () => <FormSkeleton figure fields={3} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("טוען…");
    await expect(canvasElement.querySelectorAll(".ui-loan-skel-field")).toHaveLength(3);
  },
};

/** A choice sheet's radio rows. */
export const RadioRows: Story = {
  render: () => <div className="ui-page-pad"><RadioRowsSkeleton /></div>,
};

/** A chip field's chips, under the field's real label. */
export const Chips: Story = {
  render: () => (
    <div className="ui-page-pad ui-add-field">
      <span className="ui-add-label">פרויקט</span>
      <ChipsSkeleton />
    </div>
  ),
};

/** The + sheet while the user's role loads: the three tiles and the rows card, under the sheet's real title. */
export const AddMenu: Story = {
  render: () => (
    <Sheet open onOpenChange={() => undefined} title="הוספה" panelClassName="ui-sheet-g14 ui-sheet-pad28 ui-add-menu">
      <TileMenuSkeleton rows={2} />
    </Sheet>
  ),
  play: async () => {
    await expect(document.querySelectorAll(".ui-tile-skel")).toHaveLength(3);
  },
};

/** Settings' grouped shape: two group heads, each over an inset card of icon rows. */
export const Grouped: Story = {
  render: () => <GroupedSkeleton groups={[4, 3]} />,
};

/** קטגוריות: the segmented control first, then one card. */
export const GroupedWithSegment: Story = {
  render: () => <GroupedSkeleton groups={[5]} segment />,
};
