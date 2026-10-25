import type { Meta, StoryObj } from "@storybook/react-vite";
import { SelectField } from "./select-field";
import { longHebrew, padded } from "./story-support";

const options = [
  { value: "materials", label: "חומרים" },
  { value: "labor", label: "עבודה" },
  { value: "other", label: "אחר" },
];

const meta = {
  title: "Components/SelectField",
  component: SelectField,
  decorators: [padded],
} satisfies Meta<typeof SelectField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { label: "קטגוריה", options, defaultValue: "materials" } };
export const Disabled: Story = { args: { label: "קטגוריה", options, defaultValue: "labor", disabled: true } };
export const LongHebrew: Story = {
  args: {
    label: longHebrew,
    options: [{ value: "long", label: longHebrew }, ...options],
    defaultValue: "long",
  },
};
