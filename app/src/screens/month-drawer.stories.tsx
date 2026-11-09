import type { CashMonths } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, waitFor, within } from "storybook/test";
import { cashYearMonthsQueryOptions } from "../use-cash";
import { MonthDrawer } from "./month-drawer";

/**
 * FLOW-1139: Home's month drawer while the year's nets are read: each month with data shows a skeleton bar in
 * place of its net, never ₪0. The year's read is held open, so the story never answers.
 */
const meta = {
  title: "Screens/Month drawer",
  parameters: { viewport: { defaultViewport: "flow390" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const YEAR = 2026;

function LoadingDrawer() {
  const [client] = useState(() => {
    const next = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The year's read never answers: the drawer stays on its skeleton.
    void next.query({ ...cashYearMonthsQueryOptions("off", YEAR), queryFn: () => new Promise<CashMonths>(() => undefined) });
    return next;
  });
  return (
    <QueryClientProvider client={client}>
      <MonthDrawer open onOpenChange={() => undefined} selectedKey="2026-10" firstKey="2026-01" base="ILS" currentKey="2026-10" onPick={() => undefined} />
    </QueryClientProvider>
  );
}

export const Loading: Story = {
  name: "Month drawer · year loading",
  render: () => <LoadingDrawer />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const dialog = await body.findByRole("dialog", { name: "בחירת חודש" });
    // January to October have data to read: ten skeleton nets; November and December are still to come.
    await waitFor(async () => {
      await expect(dialog.querySelectorAll(".ui-month-cell-skel")).toHaveLength(10);
    });
    await expect(within(dialog).queryByText(/₪0/)).toBeNull();
  },
};
