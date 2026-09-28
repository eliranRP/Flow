import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { SearchField } from "./search-field";
import { padded } from "./story-support";

function Demo({ value, autoFocus = false }: { value: string; autoFocus?: boolean }) {
  const [text, setText] = useState(value);
  return <SearchField label="חיפוש פרויקט" value={text} onChange={setText} autoFocus={autoFocus} />;
}

const meta = {
  title: "Components/SearchField",
  component: SearchField,
  decorators: [padded],
} satisfies Meta<typeof SearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { label: "חיפוש פרויקט", value: "", onChange: () => undefined },
  render: () => <Demo value="" />,
};
export const Filled: Story = {
  args: { label: "חיפוש פרויקט", value: "הרצל", onChange: () => undefined },
  render: () => <Demo value="הרצל" />,
};
export const Focus: Story = {
  args: { label: "חיפוש פרויקט", value: "", onChange: () => undefined },
  render: () => <Demo value="" autoFocus />,
};
