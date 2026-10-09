import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { CardSwipe, type CardStep } from "./card-swipe";
import { List, ListRow } from "./list-row";

/**
 * FLOW-314: on a touch screen, a sideways swipe on the transaction card does what ˄ ˅ do. A finger
 * moving right opens the next card, which enters from the left; moving left opens the previous one.
 */
const rows = ["ספק 1", "ספק 2", "ספק 3"];

function Demo({ start }: { start: number }) {
  const [at, setAt] = useState(start);
  const [enter, setEnter] = useState<CardStep | null>(null);
  return (
    <CardSwipe
      key={at}
      canNext={at < rows.length - 1}
      canPrev={at > 0}
      enter={enter}
      onStep={(step) => {
        setEnter(step);
        setAt((index) => index + (step === "next" ? 1 : -1));
      }}
    >
      <div className="ui-page-pad">
        <p className="t-title-3 ui-party">{rows[at]}</p>
        <p className="t-hint">{`תנועה ${String(at + 1)} מתוך ${String(rows.length)}`}</p>
      </div>
      <List>
        <ListRow variant="static" eyebrow="פרויקט" title="בניין מגורים חולון" />
        <ListRow variant="static" eyebrow="קטגוריה" title="חומרים" />
      </List>
    </CardSwipe>
  );
}

const meta = {
  title: "Components/CardSwipe",
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "dark" } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

/** A middle card: both sides have a card, so the card takes sideways moves and leaves vertical ones to the page. */
export const Middle: Story = {
  args: { start: 1 },
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>(".ui-cswipe");
    await expect(box).not.toBeNull();
    await expect(getComputedStyle(box as HTMLElement).touchAction).toBe("pan-y pinch-zoom");
    await expect(within(canvasElement).getByText("ספק 2")).toBeVisible();
  },
};
export const MiddleDark: Story = { ...Middle, name: "Middle, dark", ...dark };
export const Middle320: Story = { ...Middle, name: "Middle, 320", ...at320 };
/** The last card: a swipe right does not move it. */
export const Last: Story = { args: { start: 2 } };
