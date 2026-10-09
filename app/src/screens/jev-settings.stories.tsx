import type { Meta, StoryObj } from "@storybook/react";
import { JEV_DEFAULT, JevSettingsCard, type JevCardState } from "./jev-settings";

const off: JevCardState = { ...JEV_DEFAULT, enabled: false, status: "ready" };
const on: JevCardState = { ...JEV_DEFAULT, enabled: true, status: "ready" };
const auto: JevCardState = { ...JEV_DEFAULT, enabled: true, mode: "auto", status: "ready" };
const noKey: JevCardState = { ...on, keyMissing: true };
const offNoKey: JevCardState = { ...off, keyMissing: true };
const autoOdd: JevCardState = { ...auto, threshold: 0.92 };
const failed: JevCardState = { ...JEV_DEFAULT, status: "error" };
const loading: JevCardState = { ...JEV_DEFAULT, status: "loading" };

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

/** FLOW-348 A: no Jev key on the server locks the switch off with one line, whatever was stored. */
export const OnNoKey: Story = { args: { state: noKey }, ...light390 };
export const OnNoKeyDark: Story = { args: { state: noKey }, ...dark390 };
export const OffNoKey: Story = { args: { state: offNoKey }, ...light390 };
export const OnNoKey320: Story = { args: { state: noKey }, ...light320 };
export const OnNoKeyDark320: Story = { args: { state: noKey }, ...dark320 };

// FLOW-702: auto mode shows the threshold choices; a stored threshold off the list selects none.
export const OnAuto: Story = { args: { state: auto, optionsOpen: true }, ...light390 };
export const OnAutoDark: Story = { args: { state: auto, optionsOpen: true }, ...dark390 };
export const OnAuto320: Story = { args: { state: auto, optionsOpen: true }, ...light320 };
export const OnAutoDark320: Story = { args: { state: auto, optionsOpen: true }, ...dark320 };
export const OnAutoCustomThreshold: Story = { args: { state: autoOdd, optionsOpen: true }, ...light390 };

export const Error: Story = { args: { state: failed }, ...light390 };
export const ErrorDark: Story = { args: { state: failed }, ...dark390 };
export const Error320: Story = { args: { state: failed }, ...light320 };
export const ErrorDark320: Story = { args: { state: failed }, ...dark320 };

/** FLOW-704: the אפשרויות line is held while loading only when Jev was last known on. */
export const LoadingLastOn320: Story = { args: { state: loading, reserveOptions: true }, ...light320 };
export const LoadingLastOnDark320: Story = { args: { state: loading, reserveOptions: true }, ...dark320 };
export const LoadingLastOff320: Story = { args: { state: loading }, ...light320 };
export const LoadingLastOffDark320: Story = { args: { state: loading }, ...dark320 };
