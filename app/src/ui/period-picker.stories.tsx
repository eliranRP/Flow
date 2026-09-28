import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { PeriodPicker } from "./period-picker";
import { SegmentedControl } from "./segmented-control";
import { longHebrew } from "./story-support";
import { TopBand } from "./top-band";

function Demo({ initialOpen, pill }: { initialOpen: boolean; pill: string }) {
  const [open, setOpen] = useState(initialOpen);
  const [label, setLabel] = useState(pill);
  const [basis, setBasis] = useState<"cash" | "invoiced">("cash");
  return (
    <TopBand
      trailing={
        <PeriodPicker
          pill={label}
          open={open}
          onOpenChange={setOpen}
          options={[
            { label: "החודש", onSelect: () => { setLabel("החודש"); setOpen(false); } },
            { label: "חודש קודם", onSelect: () => { setLabel("חודש קודם"); setOpen(false); } },
            { label: "מתחילת השנה", onSelect: () => { setLabel("מתחילת השנה"); setOpen(false); } },
            { label: "כל התקופה", onSelect: () => { setLabel("כל התקופה"); setOpen(false); } },
          ]}
          footer={
            <SegmentedControl
              label="בסיס"
              value={basis}
              onChange={setBasis}
              options={[
                { value: "cash", label: "מזומן" },
                { value: "invoiced", label: "חשבוניות" },
              ]}
            />
          }
        />
      }
    >
      <p className="t-label">תקופה</p>
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
