import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stepper } from "./stepper";
import { padded } from "./story-support";

/** FLOW-106: a whole number with − and +; the split editor counts installments with it. */
function Demo({ start = 1, max = 12, hint, disabled = false, years = false }: { start?: number; max?: number; hint?: string; disabled?: boolean; years?: boolean }) {
  const [value, setValue] = useState(start);
  if (years) return <Stepper label="ריפייננס בעוד" value={value} min={1} max={max} hint={hint} valueText={yearsText} onChange={setValue} />;
  return <Stepper label="מספר תשלומים" value={value} min={1} max={max} hint={hint} disabled={disabled} onChange={setValue} />;
}

function yearsText(n: number): string {
  return n === 1 ? "שנה" : `${String(n)} שנים`;
}

const meta = {
  title: "Components/Stepper",
  component: Demo,
  decorators: [padded],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;


/** At the minimum: − is off. */
export const AtMin: Story = { args: { hint: "01/06/2026" } };
export const Middle: Story = { args: { start: 3, hint: "01/06–01/08/2026" } };
export const Disabled: Story = { args: { disabled: true } };
/** FLOW-1149: the value with its unit ("10 שנים"), the year it lands on under the label. */
export const WithUnit: Story = { args: { years: true, start: 10, max: 10, hint: "2036" } };
