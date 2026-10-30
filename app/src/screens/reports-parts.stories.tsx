import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { REPORTS_BALANCE } from "../dev/reports-sample";
import type { BalanceSheet } from "../reports";
import { StoryRoute } from "../ui/story-route";
import { BalanceView } from "./reports-parts";

/** FLOW-171: the balance sheet's account rows with a long Latin name: they break after "/" and stay inside the screen. */
const meta = {
  title: "Screens/Reports/Balance rows",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const [usd] = REPORTS_BALANCE.currencies;
if (usd == null) throw new Error("the sample has a USD sheet");
const ROW: BalanceSheet["currencies"][number] = {
  ...usd,
  equity: {
    total_minor: usd.equity.total_minor,
    accounts: [
      { account_id: "q-partner", name: "Partner A – Contributions/Distributions", is_system: false, balance_minor: 11_000_000n },
      { account_id: "q-owner", name: "Owner capital", is_system: true, balance_minor: usd.equity.total_minor - 11_000_000n },
    ],
  },
};

function Rows() {
  return (
    <StoryRoute entry="/reports?kind=balance" tabs>
      <div className="ui-rep-screen">
        <div className="ui-rep-content">
          <BalanceView row={ROW} collapse={{ isOpen: () => true, onToggle: () => undefined }} fixHref="/settings/categories" accountHref={(id) => `/reports/account?kind=balance&account=${id}`} />
        </div>
      </div>
    </StoryRoute>
  );
}

/** Each row's name stays inside its row and the screen; the long one breaks after its slash. */
async function rowsFit(canvasElement: HTMLElement, width: number) {
  const root = canvasElement.ownerDocument.documentElement;
  await expect(root.clientWidth).toBeLessThanOrEqual(width);
  await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  for (const name of canvasElement.querySelectorAll<HTMLElement>(".ui-rep-row-name")) {
    const box = name.getBoundingClientRect();
    await expect(box.left >= 0 && box.right <= root.clientWidth).toBe(true);
    await expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
  }
  const long = [...canvasElement.querySelectorAll<HTMLElement>(".ui-rep-row-name")].find((name) => name.textContent.includes("Contributions"));
  await expect(long?.querySelector("wbr")).not.toBeNull();
}

export const LongName320: Story = {
  name: "Balance rows · a long Latin name at 320",
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => <Rows />,
  play: async ({ canvasElement }) => { await rowsFit(canvasElement, 320); },
};

export const LongName393: Story = {
  name: "Balance rows · a long Latin name at 393",
  globals: { viewport: { value: "flow393", isRotated: false } },
  render: () => <Rows />,
  play: async ({ canvasElement }) => { await rowsFit(canvasElement, 393); },
};
