import type { Meta, StoryObj } from "@storybook/react";
import { forceReducedMotion } from "./reduced-motion";
import { longHebrew, padded } from "./story-support";
import { TextField } from "./text-field";

const meta = {
  title: "Components/TextField",
  component: TextField,
  tags: ["autodocs"],
  decorators: [padded],
  args: { label: "שם הפרויקט", defaultValue: "טק-ליין" },
  argTypes: {
    error: { control: "text" },
    disabled: { control: "boolean" },
    readOnly: { control: "boolean" },
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Focus draws the accent border (FLOW-363 (4)); the play function focuses the field. */
const focus = ({ canvasElement }: { canvasElement: HTMLElement }) => {
  canvasElement.querySelector("input")?.focus();
};

export const Default: Story = {};
export const Empty: Story = { args: { defaultValue: "", placeholder: "למשל שיפוץ דירה" } };
export const Focused: Story = { play: focus };
export const Error: Story = { args: { defaultValue: "", error: "חסר שם" } };
export const Disabled: Story = { args: { disabled: true } };
export const ReadOnly: Story = { args: { readOnly: true, defaultValue: "טק-ליין, שמור" } };
export const LongHebrew: Story = { args: { label: longHebrew, defaultValue: longHebrew } };
/** The focus border changes at once under reduced motion. */
export const ReducedMotion: Story = { args: { placeholder: "שם" }, decorators: [forceReducedMotion], play: focus };
