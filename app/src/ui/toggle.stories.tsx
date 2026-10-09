import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { padded } from "./story-support";
import { SplitIcon } from "./icons";
import { List } from "./list-row";
import { Toggle } from "./toggle";

function Demo(props: { label: string; hint?: string; checked?: boolean; disabled?: boolean; withIcon?: boolean }) {
  const [checked, setChecked] = useState(props.checked ?? false);
  const toggle = (
    <Toggle
      label={props.label}
      hint={props.hint}
      checked={checked}
      disabled={props.disabled}
      icon={props.withIcon === true ? <SplitIcon /> : undefined}
      onChange={setChecked}
    />
  );
  return props.withIcon === true ? <List>{toggle}</List> : toggle;
}

const meta = {
  title: "Components/Toggle",
  component: Demo,
  decorators: [padded],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = { args: { label: "רווח אחרי הוצאות כלליות" } };
export const On: Story = { args: { label: "לזכור לספק הזה", hint: "השרון ← בניין מגורים חולון · חומרים", checked: true } };
export const Disabled: Story = { args: { label: "סיכום שבועי", hint: "ההודעות לא נשלחות", disabled: true } };
export const Focus: Story = {
  args: { label: "רווח אחרי הוצאות כלליות", hint: "חלק מהכלליות נכנס לכל פרויקט", checked: true },
  play: ({ canvasElement }) => {
    canvasElement.querySelector("input")?.focus();
  },
};
export const LongHebrew: Story = {
  args: {
    label: "תזכורת ארוכה לפריטים שממתינים לאישור אחרי שהמסמכים כבר נכנסו מ־SUMIT",
    hint: "ההודעות לא נשלחות. השורה נשארת על שורה אחת.",
  },
};
/** FLOW-326: the Settings switch row, with the icon in the same slot as the rows beside it. */
export const RowWithIcon: Story = {
  args: { label: "רווח אחרי הוצאות כלליות", hint: "חלק מהכלליות נכנס לכל פרויקט", withIcon: true },
};
export const RowWithIconDark: Story = {
  ...RowWithIcon,
  globals: { theme: "dark" },
};
