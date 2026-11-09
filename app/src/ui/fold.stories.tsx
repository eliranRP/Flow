import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { FoldItem, useFold } from "./fold";
import { ListRow } from "./list-row";

const meta = {
  title: "Components/Fold",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ROWS = ["City Water", "Power Co", "Gas Co"];

/** FLOW-1141: the v3 row-card fold. A tap slides the row toward its end and folds it; the list drops it once the fold ends. */
function FoldList() {
  const { leaving, fold } = useFold();
  const [gone, setGone] = useState<readonly string[]>([]);
  return (
    <ul className="ui-page-pad" style={{ listStyle: "none", margin: 0 }}>
      {ROWS.filter((name) => !gone.includes(name)).map((name) => (
        <FoldItem key={name} leaving={leaving.has(name)}>
          <ListRow variant="button" title={name} hint="לא הוחזר · 40 ימים · 30/09/26" onClick={() => { void fold(name, () => { setGone((before) => [...before, name]); }); }} />
        </FoldItem>
      ))}
    </ul>
  );
}

export const Fold: Story = {
  render: () => <FoldList />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button", { name: /^Power Co/ });
    await userEvent.click(row);
    await expect(row.closest(".ui-fold")).toHaveAttribute("data-leaving");
    await waitFor(() => expect(canvas.queryByRole("button", { name: /^Power Co/ })).toBeNull());
  },
};
