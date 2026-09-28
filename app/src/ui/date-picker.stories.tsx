import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { userEvent, within } from "@storybook/test";
import { DatePicker } from "./date-picker";
import { longHebrew, padded } from "./story-support";

function Demo({ label, value }: { label: string; value: string | null }) {
  const [current, setCurrent] = useState(value);
  return <DatePicker label={label} value={current} onChange={setCurrent} />;
}

const meta = {
  title: "Components/DatePicker",
  component: DatePicker,
  decorators: [padded],
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "תאריך ההוצאה", value: "2026-09-21", onChange: () => undefined },
  render: () => <Demo label="תאריך ההוצאה" value="2026-09-21" />,
};
export const Empty: Story = {
  args: { label: "תאריך ההוצאה", value: null, onChange: () => undefined },
  render: () => <Demo label="תאריך ההוצאה" value={null} />,
};
export const Open: Story = {
  args: { label: "תאריך ההוצאה", value: "2026-09-21", onChange: () => undefined },
  render: () => <Demo label="תאריך ההוצאה" value="2026-09-21" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /תאריך ההוצאה/ }));
  },
};
export const LongHebrew: Story = {
  args: { label: longHebrew, value: "2026-09-21", onChange: () => undefined },
  render: () => <Demo label={longHebrew} value="2026-09-21" />,
};
