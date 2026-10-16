import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { CloseIcon } from "./icons";
import { IconButton } from "./icon-button";
import { SwipeRow } from "./swipe-row";

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
        <SwipeRow key={part.key} onRemove={() => { remove(part.key); }}>
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
        </SwipeRow>
      ))}
    </div>
  );
}

const meta = {
  title: "Components/SwipeRow",
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: the parts with their ✕; the "הסרה" mark under each row stays hidden. */
export const Parts: Story = {
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector<HTMLElement>(".ui-swipe-row");
    await expect(frame).not.toBeNull();
    await expect(getComputedStyle(frame as HTMLElement).touchAction).toBe("pan-y pinch-zoom");
    const under = canvasElement.querySelector<HTMLElement>(".ui-swipe-row-under");
    await expect(getComputedStyle(under as HTMLElement).visibility).toBe("hidden");
    await expect(within(canvasElement).getByRole("button", { name: "הסרת החלק חשמל" })).toBeVisible();
  },
};

/** Mid-swipe: the first part has moved 120px toward the start side over "הסרה". */
export const Dragging: Story = {
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector<HTMLElement>(".ui-swipe-row");
    const row = frame?.querySelector<HTMLElement>(".ui-swipe-row-body");
    if (!frame || !row) throw new Error("no part");
    frame.setAttribute("data-drag", "");
    row.style.transform = "translateX(120px)";
    const mark = frame.querySelector<HTMLElement>(".ui-swipe-row-under");
    await expect(getComputedStyle(mark as HTMLElement).visibility).toBe("visible");
  },
};
/** Open: the row rests over its action, which names the change: "התעלמות מההתראה". */
export const Revealed: Story = {
  render: () => (
    <div className="ui-split-card ui-lsplit-card">
      <SwipeRow onRemove={() => undefined} reveal={{ label: "התעלמות מההתראה", onAct: () => undefined }}>
        <div className="ui-lsplit-part">
          <span className="ui-lsplit-name">ביטוח רכב</span>
        </div>
      </SwipeRow>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const frame = canvasElement.querySelector<HTMLElement>(".ui-swipe-row");
    if (!frame) throw new Error("no swipe row");
    frame.setAttribute("data-open", "");
    await expect(within(canvasElement).getByRole("button", { name: "התעלמות מההתראה" })).toBeVisible();
  },
};
