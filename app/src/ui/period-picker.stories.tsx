import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { allTime, periodPillLabel, type PeriodChoice } from "../period";
import { PeriodPicker, PresetPeriodSheet, RangeSheet } from "./period-picker";
import { longHebrew } from "./story-support";
import { TopBand } from "./top-band";

/** FLOW-351: the pill opens the shared sheet (FLOW-349), as Home and the breakdown do. */
function Demo({ initialOpen, pill }: { initialOpen: boolean; pill?: string }) {
  const [open, setOpen] = useState(initialOpen);
  const [period, setPeriod] = useState<PeriodChoice>(allTime());
  return (
    <TopBand
      trailing={
        <PeriodPicker
          pill={pill ?? periodPillLabel(period)}
          open={open}
          onOpenChange={setOpen}
          period={period}
          onChange={setPeriod}
        />
      }
    />
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

export const Closed: Story = { args, render: () => <Demo initialOpen={false} /> };
export const Open: Story = {
  args: { ...args, open: true },
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <Demo initialOpen />,
};
export const LongHebrew: Story = { args: { ...args, pill: longHebrew }, render: () => <Demo initialOpen={false} pill={longHebrew} /> };
export const Range: Story = {
  args,
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <RangeSheet open onOpenChange={() => undefined} onApply={() => undefined} />,
};

/** FLOW-349: the one period list Home, the breakdown and Search share. */
function Shared() {
  const [period, setPeriod] = useState<PeriodChoice>(allTime());
  return <PresetPeriodSheet period={period} onChange={setPeriod} open onOpenChange={() => undefined} />;
}
export const SharedSheet: Story = {
  args,
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  render: () => <Shared />,
};
export const SharedSheet320: Story = {
  args,
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <Shared />,
};
export const SharedSheetDark320: Story = {
  args,
  globals: { theme: "dark" },
  parameters: { viewport: { defaultViewport: "flow320" } },
  render: () => <Shared />,
};
