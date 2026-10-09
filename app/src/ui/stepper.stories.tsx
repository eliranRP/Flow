import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Stepper } from "./stepper";
import { padded } from "./story-support";

/** FLOW-106: a whole number with − and +; the split editor counts installments with it. */
function Demo({ start = 1, max = 12, hint, disabled = false }: { start?: number; max?: number; hint?: string; disabled?: boolean }) {
  const [value, setValue] = useState(start);
  return <Stepper label="מספר תשלומים" value={value} min={1} max={max} hint={hint} disabled={disabled} onChange={setValue} />;
}

const meta = {
  title: "Components/Stepper",
  component: Demo,
  decorators: [padded],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark390 = { globals: { theme: "dark" } };
const light320 = { parameters: { viewport: { defaultViewport: "flow320" } } };

/** At the minimum: − is off. */
export const AtMin: Story = { args: { hint: "01/06/2026" } };
export const Middle: Story = { args: { start: 3, hint: "01/06–01/08/2026" } };
export const MiddleDark: Story = { args: { start: 3, hint: "01/06–01/08/2026" }, ...dark390 };
export const Middle320: Story = { args: { start: 3, hint: "01/06–01/08/2026" }, ...light320 };
/** At the maximum: + is off. */
export const AtMax: Story = { args: { start: 12, max: 12 } };
export const Disabled: Story = { args: { disabled: true } };
