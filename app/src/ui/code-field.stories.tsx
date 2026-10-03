import type { Meta, StoryObj } from "@storybook/react";
import { CodeField } from "./code-field";
import { padded } from "./story-support";

const meta = {
  title: "Components/CodeField",
  component: CodeField,
  decorators: [padded],
} satisfies Meta<typeof CodeField>;

export default meta;
type Story = StoryObj<typeof meta>;

const onCopy = () => undefined;
const longCommand = "claude mcp add --scope user --transport http flow \"https://example.com/functions/v1/flow-mcp\" --header \"Authorization: Bearer example\"";

const shortArgs = {
  label: "כתובת",
  labelId: "code-short",
  value: "https://example.com/mcp",
  copyLabel: "העתקה: כתובת",
  failed: false,
  onCopy,
};
const longArgs = {
  label: "פקודה",
  labelId: "code-long",
  value: longCommand,
  copyLabel: "העתקה: פקודה",
  failed: false,
  onCopy,
};
const failedArgs = {
  label: "קוד",
  labelId: "code-failed",
  value: "example-code",
  copyLabel: "העתקה: קוד",
  failed: true,
  onCopy,
};
const emptyArgs = {
  label: "כתובת",
  labelId: "code-empty",
  value: "",
  copyLabel: "העתקה: כתובת",
  failed: false,
  onCopy,
};

function frame(width: "flow320" | "flow390", theme: "light" | "dark"): Pick<Story, "globals" | "parameters"> {
  return {
    ...(theme === "dark" ? { globals: { theme: "dark" as const } } : {}),
    parameters: { viewport: { defaultViewport: width } },
  };
}

export const Short390: Story = { args: shortArgs, ...frame("flow390", "light") };
export const Short390Dark: Story = { args: shortArgs, ...frame("flow390", "dark") };
export const Short320: Story = { args: shortArgs, ...frame("flow320", "light") };
export const Short320Dark: Story = { args: shortArgs, ...frame("flow320", "dark") };
export const Long390: Story = { args: longArgs, ...frame("flow390", "light") };
export const Long390Dark: Story = { args: longArgs, ...frame("flow390", "dark") };
export const Long320: Story = { args: longArgs, ...frame("flow320", "light") };
export const Long320Dark: Story = { args: longArgs, ...frame("flow320", "dark") };
export const Failed390: Story = { args: failedArgs, ...frame("flow390", "light") };
export const Failed390Dark: Story = { args: failedArgs, ...frame("flow390", "dark") };
export const Failed320: Story = { args: failedArgs, ...frame("flow320", "light") };
export const Failed320Dark: Story = { args: failedArgs, ...frame("flow320", "dark") };
export const Empty390: Story = { args: emptyArgs, ...frame("flow390", "light") };
export const Empty390Dark: Story = { args: emptyArgs, ...frame("flow390", "dark") };
export const Empty320: Story = { args: emptyArgs, ...frame("flow320", "light") };
export const Empty320Dark: Story = { args: emptyArgs, ...frame("flow320", "dark") };
