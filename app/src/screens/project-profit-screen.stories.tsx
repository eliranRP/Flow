import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor, within } from "storybook/test";
import { JUNIPER_PROFIT, NEW_PROJECT_PROFIT } from "../dev/project-profit-sample";
import { ProjectProfitScreen } from "./project-profit-screen";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const sample = JUNIPER_PROFIT;

function ProfitRoute({ entry, data = sample }: { entry: string; data?: typeof sample }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <ProjectProfitScreen sample={data} />
    </StoryRoute>
  );
}

/** FLOW-1044 (board V3-ProjectProfit): the band, then לפי חודש with its sticky head. */
export const ProjectProfit: Story = {
  name: "Project profit, by month",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "רווח מתחילת הפרויקט" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "לפי חודש" })).toBeInTheDocument();
  },
};

/** FLOW-1044: לפי קטגוריה, the income group and the expense categories, largest first. */
export const ProjectProfitByCategory: Story = {
  name: "Project profit, by category",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit?by=category" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "הוצאות" })).toBeInTheDocument();
    await expect(canvas.queryByRole("heading", { name: "לפי חודש" })).toBeNull();
  },
};

/** FLOW-1044 (board V3-ProjectProfit-Flip): a renovation says its renovation is not in the monthly profit. */
export const ProjectProfitRenovation: Story = {
  name: "Project profit, a renovation's note",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit" data={{ ...sample, type: "שיפוץ" }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/השיפוץ לא נספר ברווח/u)).toBeInTheDocument();
  },
};

/** FLOW-1044: docked, the order rides in the band bar. */
export const ProjectProfitDocked: Story = {
  name: "Project profit, the order docked",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit" />,
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 600, behavior: "instant" });
    await waitFor(() => expect(canvasElement.querySelector(".ui-compact-dock")).toHaveAttribute("data-open"));
  },
};

export const ProjectProfitLoading: Story = {
  name: "Project profit, loading",
  render: () => (
    <StoryRoute entry="/projects/juniper-ct/profit?preview=loading" tabs>
      <ProjectProfitScreen />
    </StoryRoute>
  ),
};

/** Reached from the company profit page: Back names "רווח". */
export const ProjectProfitFromCompany: Story = {
  name: "Project profit, opened from company profit",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit?from=profit" />,
};

/** A project with no lines yet (board States, profitEmpty). */
export const ProjectProfitEmpty: Story = {
  name: "Project profit, nothing to add up yet",
  render: () => <ProfitRoute entry="/projects/linden-ct/profit" data={NEW_PROJECT_PROFIT} />,
};

/** Offline (FLOW-969): the figures stay, with the moment they are from under them. */
export const ProjectProfitOffline: Story = {
  name: "Project profit, offline",
  render: () => <ProfitRoute entry="/projects/juniper-ct/profit" data={{ ...sample, offlineSince: Date.UTC(2026, 9, 26, 6, 41) }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/אין חיבור · מוצג המצב/)).toBeInTheDocument();
  },
};

/** The read failed (FLOW-969): the failure card in place of the figures, with נסו שוב and צריך עזרה?. */
export const ProjectProfitFailed: Story = {
  name: "Project profit, the read failed",
  render: () => (
    <StoryRoute entry="/projects/juniper-ct/profit?preview=error-server" tabs>
      <ProjectProfitScreen />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "צריך עזרה?" })).toBeInTheDocument();
  },
};
