import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ChargeSwitches, type ChargeSwitchState } from "./charge-switches";
import { PaceSheet } from "./pace-sheet";
import { ChartIcon } from "./icons";
import { List } from "./list-row";
import { padded } from "./story-support";
import { Toggle } from "./toggle";

/**
 * FLOW-415 (layout A): the payment page's list, with נספר ברווח above the two new switches. While
 * חיוב קבוע is on, a tap on its row opens "כל כמה זמן" (step D). Invented data.
 */
function Demo(props: ChargeSwitchState & { disabled?: boolean; busy?: boolean }) {
  const [state, setState] = useState<ChargeSwitchState>(props);
  const [open, setOpen] = useState(false);
  return (
    <>
      <List>
        <Toggle label="נספר ברווח" icon={<ChartIcon />} checked disabled={props.disabled} onChange={() => undefined} />
        <ChargeSwitches
          state={state}
          disabled={props.disabled}
          busy={{ recurring: props.busy }}
          onCash={(inCash) => { setState({ ...state, inCash }); }}
          onRecurring={(recurring) => { setState({ ...state, recurring }); }}
          onPace={() => { setOpen(true); }}
        />
      </List>
      <PaceSheet
        open={open}
        onOpenChange={setOpen}
        value={state.pace ?? "month"}
        saving={null}
        onPick={(pace, close) => {
          setState({ ...state, pace });
          close();
        }}
      />
    </>
  );
}

const meta = {
  title: "Components/ChargeSwitches",
  component: Demo,
  decorators: [padded],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

const detected = { inCash: true, recurring: true, typicalDay: 4, detected: true };
export const Detected: Story = { name: "Recurring, found by itself", args: detected };
export const DetectedDark: Story = { name: "Recurring, found by itself, dark", args: detected, globals: { theme: "dark" } };
export const Detected320: Story = { name: "Recurring, found by itself, 320", args: detected, parameters: { viewport: { defaultViewport: "flow320" } } };
export const EveryQuarter: Story = { name: "Recurring every quarter, set by the owner", args: { ...detected, detected: false, pace: "quarter" } };
export const EveryQuarter320: Story = { name: "Recurring every quarter, 320", args: { ...detected, pace: "quarter" }, parameters: { viewport: { defaultViewport: "flow320" } } };
export const SetByOwner: Story = { name: "Recurring, set by the owner", args: { ...detected, detected: false } };
export const NotRecurring: Story = { name: "Not recurring, no usual day", args: { inCash: true, recurring: false, typicalDay: null, detected: false } };
export const OutOfCash: Story = { name: "Kept out of the cash view", args: { ...detected, inCash: false } };
export const Busy: Story = { name: "Recurring change running", args: { ...detected, busy: true } };
export const Viewer: Story = { name: "Viewer: both disabled", args: { ...detected, disabled: true } };
