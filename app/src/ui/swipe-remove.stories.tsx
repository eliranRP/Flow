import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { CloseIcon } from "./icons";
import { IconButton } from "./icon-button";
import { SwipeRemove } from "./swipe-remove";

/**
 * FLOW-325 (plan §10): on a touch screen, a split part swiped toward the start side (right) is
 * removed, as its ✕ does. The row follows the finger over a neutral "הסרה" and goes past 30% of its
 * width or on a flick; short of that it settles back.
 */
const PARTS = [
  { key: "a", name: "חשמל", project: "פרויקט לדוגמה א" },
  { key: "b", name: "ביטוח", project: "פרויקט לדוגמה ב" },
];

function Demo() {
  const [parts, setParts] = useState(PARTS);
  const remove = (key: string) => { setParts((list) => list.filter((part) => part.key !== key)); };
  return (
    <div className="ui-split-card ui-lsplit-card">
      {parts.map((part) => (
        <SwipeRemove key={part.key} onRemove={() => { remove(part.key); }}>
          <div className="ui-lsplit-part">
            <div className="ui-lsplit-text">
              <span className="ui-lsplit-pick">
                <span className="ui-lsplit-title"><span className="ui-lsplit-name">{part.name}</span></span>
                <span className="ui-lsplit-project">{part.project}</span>
              </span>
              <IconButton className="ui-lsplit-remove" label={`הסרת החלק ${part.name}`} onClick={() => { remove(part.key); }}>
                <CloseIcon size={18} />
              </IconButton>
            </div>
          </div>
        </SwipeRemove>
      ))}
    </div>
  );
}

const meta = {
  title: "Components/SwipeRemove",
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "dark" } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

/** At rest: the parts with their ✕; the "הסרה" mark under each row stays hidden. */
export const Parts: Story = {
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector<HTMLElement>(".ui-sremove");
    await expect(frame).not.toBeNull();
    await expect(getComputedStyle(frame as HTMLElement).touchAction).toBe("pan-y pinch-zoom");
    const under = canvasElement.querySelector<HTMLElement>(".ui-sremove-under");
    await expect(getComputedStyle(under as HTMLElement).visibility).toBe("hidden");
    await expect(within(canvasElement).getByRole("button", { name: "הסרת החלק חשמל" })).toBeVisible();
  },
};
export const PartsDark: Story = { ...Parts, name: "Parts, dark", ...dark };

/** Mid-swipe: the first part has moved 120px toward the start side over "הסרה". */
export const Dragging: Story = {
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector<HTMLElement>(".ui-sremove");
    const row = frame?.querySelector<HTMLElement>(".ui-sremove-row");
    if (!frame || !row) throw new Error("no part");
    frame.setAttribute("data-drag", "");
    row.style.transform = "translateX(120px)";
    const mark = frame.querySelector<HTMLElement>(".ui-sremove-under");
    await expect(getComputedStyle(mark as HTMLElement).visibility).toBe("visible");
  },
};
export const DraggingDark: Story = { ...Dragging, name: "Dragging, dark", ...dark };
export const Dragging320: Story = { ...Dragging, name: "Dragging, 320", ...at320 };
