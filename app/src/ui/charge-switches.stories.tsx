import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ChargeSwitches, type ChargeSwitchState, PACE_COPY } from "./charge-switches";
import { ChoiceSheet } from "./choice-sheet";
import { ChartIcon } from "./icons";
import { List } from "./list-row";
import { padded } from "./story-support";
import { Toggle } from "./toggle";

/**
 * FLOW-415 (layout A): the payment page's list, with נספר ברווח above the two new switches. While
 * חיוב קבוע is on, a tap on its row opens "כל כמה זמן" (step D). Invented data.
 */
function Demo(props: ChargeSwitchState & { disabled?: boolean }) {
  const [state, setState] = useState<ChargeSwitchState>(props);
  const [open, setOpen] = useState(false);
  return (
    <>
      <List>
        <Toggle label="נספר ברווח" icon={<ChartIcon size={24} stroke={1.9} />} checked disabled={props.disabled} onChange={() => undefined} />
        <ChargeSwitches
          state={state}
          disabled={props.disabled}
          onCash={(inCash) => { setState({ ...state, inCash }); }}
          onRecurring={(recurring) => { setState({ ...state, recurring }); }}
          onPace={() => { setOpen(true); }}
        />
      </List>
      <ChoiceSheet
        copy={PACE_COPY}
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
export const EveryQuarter: Story = { name: "Recurring every quarter, set by the owner", args: { ...detected, detected: false, pace: "quarter" } };
export const EveryQuarterDetected: Story = { name: "Recurring every quarter", args: { ...detected, pace: "quarter" } };
export const SetByOwner: Story = { name: "Recurring, set by the owner", args: { ...detected, detected: false } };
export const NotRecurring: Story = { name: "Not recurring, no usual day", args: { inCash: true, recurring: false, typicalDay: null, detected: false } };
export const OutOfCash: Story = { name: "Kept out of the cash view", args: { ...detected, inCash: false } };
export const Viewer: Story = { name: "Viewer: both disabled", args: { ...detected, disabled: true } };
