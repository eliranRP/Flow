import { useState } from "react";
import { fn } from "@storybook/test";
import type { Meta, StoryObj } from "@storybook/react";
import { PeriodPicker, RangeSheet } from "./period-picker";
import { longHebrew } from "./story-support";
import { TopBand } from "./top-band";

function Demo({ initialOpen, pill }: { initialOpen: boolean; pill: string }) {
  const [open, setOpen] = useState(initialOpen);
  const [label, setLabel] = useState(pill);
  return (
    <TopBand
      trailing={
        <PeriodPicker
          pill={label}
          open={open}
          onOpenChange={setOpen}
          onCustom={fn()}
          options={[
            { label: "החודש", hint: "ספטמבר 2026", selected: label === "החודש", onSelect: () => { setLabel("החודש"); } },
            { label: "חודש קודם", hint: "אוגוסט 2026", selected: label === "חודש קודם", onSelect: () => { setLabel("חודש קודם"); } },
            { label: "מתחילת השנה", hint: "2026", selected: label === "מתחילת השנה", onSelect: () => { setLabel("מתחילת השנה"); } },
            { label: "כל התקופה", hint: "כל החשבוניות", selected: label === "כל התקופה", onSelect: () => { setLabel("כל התקופה"); } },
          ]}
        />
      }
    >
      {null}
    </TopBand>
  );
}

const meta = {
  title: "Components/PeriodPicker",
  component: PeriodPicker,
} satisfies Meta<typeof PeriodPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

const args = {
  pill: "כל התקופה",
  open: false,
  onOpenChange: () => undefined,
  options: [{ label: "כל התקופה", onSelect: () => undefined }],
};

export const Closed: Story = { args, render: () => <Demo initialOpen={false} pill="כל התקופה" /> };
export const Open: Story = { args: { ...args, open: true }, render: () => <Demo initialOpen pill="כל התקופה" /> };
export const LongHebrew: Story = { args: { ...args, pill: longHebrew }, render: () => <Demo initialOpen={false} pill={longHebrew} /> };
export const Range: Story = {
  args,
  render: () => <RangeSheet open onOpenChange={() => undefined} onApply={() => undefined} />,
};
