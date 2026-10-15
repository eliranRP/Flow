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

export const Off: Story = { args: { state: off } };

export const On: Story = { args: { state: on, optionsOpen: true } };

/** FLOW-348 A: no Jev key on the server locks the switch off with one line, whatever was stored. */
export const OnNoKey: Story = { args: { state: noKey } };
export const OffNoKey: Story = { args: { state: offNoKey } };

// FLOW-702: auto mode shows the threshold choices; a stored threshold off the list selects none.
export const OnAuto: Story = { args: { state: auto, optionsOpen: true } };
export const OnAutoCustomThreshold: Story = { args: { state: autoOdd, optionsOpen: true } };

export const Error: Story = { args: { state: failed } };

/** FLOW-704: the אפשרויות line is held while loading only when Jev was last known on. */
export const LoadingLastOn: Story = { args: { state: loading, reserveOptions: true } };
export const LoadingLastOff: Story = { args: { state: loading } };
