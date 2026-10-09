import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { DateSheet } from "./date-sheet";

/**
 * The date sheet with a floor (FLOW-106 §3.2): days before the last attached payment are
 * disabled, the reason sits under the title, and the button says החלה. Days are fixed so the
 * story does not move with today.
 */
function Demo({ min, max, reason, error, busy }: { min?: string; max?: string; reason?: string; error?: string; busy?: boolean }) {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("2026-10-01");
  return (
    <DateSheet
      open={open}
      onOpenChange={setOpen}
      title="תאריך פירעון"
      value={value}
      onApply={setValue}
      allowFuture
      min={min ?? null}
      max={max ?? null}
      reason={reason}
      applyLabel="החלה"
      error={error ?? null}
      busy={busy}
    />
  );
}

const meta = {
  title: "Components/DateSheet",
  component: Demo,
  args: {
    min: "2026-10-01",
    reason: "התשלום האחרון שויך ב־01/10/2026. אי אפשר לבחור יום לפניו.",
  },
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "dark" } };
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

export const Floor: Story = {};
export const FloorDark: Story = { ...dark };
export const Floor320: Story = { ...at320 };
export const FloorDark320: Story = { ...dark, ...at320 };
/** The server refused the day: the sheet stays open and says why. */
export const Refused: Story = { args: { error: "יש תשלום משויך אחרי התאריך הזה. בחרו תאריך מאוחר יותר." } };
export const RefusedDark320: Story = { args: { error: "יש תשלום משויך אחרי התאריך הזה. בחרו תאריך מאוחר יותר." }, ...dark, ...at320 };
export const Saving: Story = { args: { busy: true } };
export const Range: Story = { args: { min: "2026-09-10", max: "2026-10-20", reason: undefined } };

/** FLOW-350: outward chevrons and the picked day as a filled circle, as in mockup 15b. */
export const PickedDay320: Story = { args: { min: undefined, reason: undefined }, ...at320 };
export const PickedDayDark320: Story = { args: { min: undefined, reason: undefined }, ...dark, ...at320 };
