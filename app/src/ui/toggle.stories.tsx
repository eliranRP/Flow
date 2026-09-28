import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { padded } from "./story-support";
import { Toggle } from "./toggle";

function Demo(props: { label: string; hint?: string; checked?: boolean; disabled?: boolean }) {
  const [checked, setChecked] = useState(props.checked ?? false);
  return <Toggle label={props.label} hint={props.hint} checked={checked} disabled={props.disabled} onChange={setChecked} />;
}

const meta = {
  title: "Components/Toggle",
  component: Demo,
  decorators: [padded],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = { args: { label: "אחרי חלק בהוצאות כלליות", hint: "כבוי · מציג רווח לפני כלליות" } };
export const On: Story = { args: { label: "לזכור לספק הזה", hint: "השרון ← בניין מגורים חולון · חומרים", checked: true } };
export const Disabled: Story = { args: { label: "סיכום שבועי", hint: "ההודעות לא נשלחות", disabled: true } };
export const Focus: Story = {
  args: { label: "רווח אחרי חלק בכלליות", hint: "ברירת מחדל בבית ובפרויקט", checked: true },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector("input")?.focus();
  },
};
export const LongHebrew: Story = {
  args: {
    label: "תזכורת ארוכה לפריטים שממתינים לאישור אחרי שהמסמכים כבר נכנסו מ-SUMIT",
    hint: "ההודעות לא נשלחות. השורה נשארת על שורה אחת.",
  },
};
