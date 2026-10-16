import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { COUNTED_REASON_LOAN, COUNTED_REASON_OTHER, CountedInRow, CountedInSheet } from "./counted-in";
import { padded } from "./story-support";

/**
 * FLOW-366 (guide §7.10): the "נספר ב" row and its sheet. Each story is one state of the two
 * switches; the sheet's switches toggle locally, so the story shows the change at once.
 */
function Demo({ pnl: start, cash: startCash, reason, open = false, locked = false }: { pnl: boolean; cash: boolean; reason: string | null; open?: boolean; locked?: boolean }) {
  const [pnl, setPnl] = useState(start);
  const [cash, setCash] = useState(startCash);
  const [sheet, setSheet] = useState(open);
  return (
    <>
      <CountedInRow pnl={pnl} cash={cash} reason={reason} locked={locked} lockedHint={reason ?? undefined} onOpen={() => { setSheet(true); }} />
      <CountedInSheet open={sheet} onOpenChange={setSheet} pnl={pnl} cash={cash} reason={reason} onPnl={() => { setPnl((value) => !value); }} onCash={setCash} />
    </>
  );
}

const meta = {
  title: "Components/CountedIn",
  component: Demo,
  decorators: [padded],
  parameters: { viewport: { defaultViewport: "flow390-short" } },
  tags: ["autodocs"],
} satisfies Meta<typeof Demo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BothOn: Story = { args: { pnl: true, cash: true, reason: null } };
export const CashOnly: Story = { args: { pnl: false, cash: true, reason: COUNTED_REASON_OTHER } };
export const LoanPart: Story = { args: { pnl: false, cash: true, reason: COUNTED_REASON_LOAN } };
export const NotInProfitOrCash: Story = { args: { pnl: false, cash: false, reason: null } };
export const SheetOpen: Story = { args: { pnl: false, cash: true, reason: COUNTED_REASON_OTHER, open: true } };
/** A loan line or a mixed split: the row says why and does not open a sheet. */
export const Locked: Story = { args: { pnl: false, cash: true, reason: COUNTED_REASON_LOAN, locked: true } };
