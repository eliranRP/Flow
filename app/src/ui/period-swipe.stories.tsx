import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { allTime, presetPeriod, windowLabel, type PeriodChoice } from "../period";
import { Amount } from "./amount";
import { PeriodSwipe } from "./period-swipe";
import { TopBand } from "./top-band";

/**
 * FLOW-336 (decision 0150): the band's hero figure takes a sideways swipe that steps the period,
 * as the stepper does. On a touch screen, a finger moving right goes earlier and left goes later.
 */
function Demo({ start }: { start: "months3" | "all" }) {
  const [period, setPeriod] = useState<PeriodChoice>(() => (start === "all" ? allTime() : presetPeriod("months3")));
  return (
    <TopBand
      wordmark={false}
      hero={
        <PeriodSwipe period={period} onChange={setPeriod}>
          <p className="ui-band-label t-label">{`רווח, ${windowLabel(period)}`}</p>
          <h1 className="ui-band-fade t-hero"><Amount agorot={1_840_000n} /></h1>
          <p className="t-label">הכנסות פחות הוצאות</p>
        </PeriodSwipe>
      }
    />
  );
}

const meta = {
  title: "Components/PeriodSwipe",
  component: Demo,
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A steppable window: the figure takes the swipe and leaves vertical moves to the page. */
export const Steppable: Story = {
  args: { start: "months3" },
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>(".ui-pswipe");
    await expect(box).not.toBeNull();
    await expect(box).toHaveAttribute("data-period-swipe");
    await expect(getComputedStyle(box as HTMLElement).touchAction).toBe("pan-y pinch-zoom");
    await expect(within(canvasElement).getByRole("heading", { name: "₪18,400" })).toBeVisible();
  },
};
/** הכול has no arrows, so the figure takes no swipe either. */
export const All: Story = {
  args: { start: "all" },
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLElement>(".ui-pswipe");
    await expect(box).not.toHaveAttribute("data-period-swipe");
  },
};
