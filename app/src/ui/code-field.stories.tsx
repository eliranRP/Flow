import type { Meta, StoryObj } from "@storybook/react";
import { CodeField } from "./code-field";
import { forceReducedMotion } from "./reduced-motion";
import { padded } from "./story-support";

const meta = {
  title: "Components/CodeField",
  component: CodeField,
  tags: ["autodocs"],
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

export const Short: Story = { args: shortArgs };
export const Long: Story = { args: longArgs };
export const Failed: Story = { args: failedArgs };
export const Empty: Story = { args: emptyArgs };
/** The copy button presses with opacity; under reduced motion it changes at once. */
export const ReducedMotion: Story = { args: shortArgs, decorators: [forceReducedMotion] };
