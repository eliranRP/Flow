import type { Meta, StoryObj } from "@storybook/react";
import { JEV_DEFAULT, JevSettingsCard, type JevCardState } from "./jev-settings";

const off: JevCardState = { ...JEV_DEFAULT, enabled: false, status: "ready" };
const on: JevCardState = { ...JEV_DEFAULT, enabled: true, status: "ready" };
const failed: JevCardState = { ...JEV_DEFAULT, status: "error" };

const meta = {
  title: "Screens/Jev settings",
  component: JevSettingsCard,
  args: { state: off, onRetry: () => undefined },
} satisfies Meta<typeof JevSettingsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const light390 = { parameters: { viewport: { defaultViewport: "flow390" } } };
const dark390 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow390" } } };
const light320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const dark320 = { globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } };

export const Off: Story = { args: { state: off }, ...light390 };
export const OffDark: Story = { args: { state: off }, ...dark390 };
export const Off320: Story = { args: { state: off }, ...light320 };
export const OffDark320: Story = { args: { state: off }, ...dark320 };

export const On: Story = { args: { state: on, optionsOpen: true }, ...light390 };
export const OnDark: Story = { args: { state: on, optionsOpen: true }, ...dark390 };
export const On320: Story = { args: { state: on, optionsOpen: true }, ...light320 };
export const OnDark320: Story = { args: { state: on, optionsOpen: true }, ...dark320 };

export const Error: Story = { args: { state: failed }, ...light390 };
export const ErrorDark: Story = { args: { state: failed }, ...dark390 };
export const Error320: Story = { args: { state: failed }, ...light320 };
export const ErrorDark320: Story = { args: { state: failed }, ...dark320 };
