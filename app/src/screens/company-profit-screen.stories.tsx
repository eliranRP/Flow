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

// The board draws the frames at 320 and 393 (the flow320 and flow393 viewports).
const at320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const at393 = { parameters: { viewport: { defaultViewport: "flow393" } } };

export const ByProject320: Story = { ...ByProject, name: "By project, 320", ...at320 };
export const ByProject393: Story = { ...ByProject, name: "By project, 393", ...at393 };
export const ByCategory320: Story = { ...ByCategory, name: "By category, one row open, 320", ...at320 };
export const ByCategory393: Story = { ...ByCategory, name: "By category, one row open, 393", ...at393 };
export const ByDate320: Story = { ...ByDate, name: "By date, 320", ...at320 };
export const ByDate393: Story = { ...ByDate, name: "By date, 393", ...at393 };
export const ByAmount320: Story = { ...ByAmount, name: "By amount, 320", ...at320 };
export const ByAmount393: Story = { ...ByAmount, name: "By amount, 393", ...at393 };
export const Loss320: Story = { ...Loss, name: "Loss, 320", ...at320 };
export const Loss393: Story = { ...Loss, name: "Loss, 393", ...at393 };
export const BasisSheet320: Story = { ...BasisSheet, name: "Basis sheet, 320", ...at320 };
export const BasisSheet393: Story = { ...BasisSheet, name: "Basis sheet, 393", ...at393 };
