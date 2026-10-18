import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import { COMPANY_PROFIT_SAMPLE } from "../dev/company-profit-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { CompanyProfitScreen, type CompanyProfitSample } from "./company-profit-screen";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page at a route: `entry` carries `?by=` and the sample's own flags. */
function ProfitRoute({ entry, sample = COMPANY_PROFIT_SAMPLE }: { entry: string; sample?: CompanyProfitSample }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <CompanyProfitScreen sample={sample} />
    </StoryRoute>
  );
}

export const ByProject: Story = { name: "By project", render: () => <ProfitRoute entry="/profit" /> };

/** One category open: its counted lines under the row, the row's chevron turned. */
export const ByCategory: Story = {
  name: "By category, one row open",
  render: () => <ProfitRoute entry="/profit?by=category" sample={{ ...COMPANY_PROFIT_SAMPLE, openFirst: true }} />,
};

export const ByDate: Story = { name: "By date", render: () => <ProfitRoute entry="/profit?by=date" /> };

export const ByAmount: Story = { name: "By amount", render: () => <ProfitRoute entry="/profit?by=amount" /> };

/** The month is a loss: the figure and the loss rows read in the signal colour, with the minus. */
export const Loss: Story = { name: "Loss", render: () => <ProfitRoute entry="/profit" /> };

/** Scrolled: the compact bar shows the figure and the chips once the large title scrolls off. */
export const Scrolled: Story = {
  name: "Scrolled, compact bar",
  render: () => <ProfitRoute entry="/profit?by=date" />,
  play: async ({ canvasElement }) => {
    window.scrollTo(0, 400);
    const bar = await waitFor(() => canvasElement.ownerDocument.querySelector<HTMLElement>(".ui-compact-bar"));
    if (bar == null) throw new Error("the compact bar is not drawn");
    await expect(bar).toBeInTheDocument();
    window.scrollTo(0, 0);
  },
};

/** The basis sheet over the page: the two choices with their notes. */
export const BasisSheet: Story = {
  name: "Basis sheet",
  render: () => <ProfitRoute entry="/profit" sample={{ ...COMPANY_PROFIT_SAMPLE, sheetOpen: true }} />,
};
