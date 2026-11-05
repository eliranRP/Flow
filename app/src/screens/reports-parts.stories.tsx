import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { REPORTS_BALANCE, REPORTS_TODAY } from "../dev/reports-sample";
import type { BalanceSheet } from "../reports";
import { StoryRoute } from "../ui/story-route";
import { BalanceReportScreen } from "./reports-balance-screen";

/** FLOW-171: the balance sheet's account rows with a long Latin name: they break after "/" and stay inside the screen. */
const meta = {
  title: "Screens/Reports/Balance rows",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const [usd] = REPORTS_BALANCE.currencies;
if (usd == null) throw new Error("the sample has a USD sheet");
const SHEET: BalanceSheet = {
  ...REPORTS_BALANCE,
  currencies: [{
    ...usd,
    equity: {
      total_minor: usd.equity.total_minor,
      accounts: [
        { account_id: "q-partner", name: "Partner A – Contributions/Distributions", is_system: false, balance_minor: 11_000_000n },
        { account_id: "q-owner", name: "Owner capital", is_system: true, balance_minor: usd.equity.total_minor - 11_000_000n },
      ],
    },
  }],
};

function Rows() {
  return (
    <StoryRoute entry="/reports/balance?view=liabilities" tabs>
      <BalanceReportScreen sample={{ today: REPORTS_TODAY, balance: SHEET }} />
    </StoryRoute>
  );
}

/** Each row's name stays inside its row and the screen; the long one breaks after its slash. */
async function rowsFit(canvasElement: HTMLElement, width: number) {
  const root = canvasElement.ownerDocument.documentElement;
  await expect(root.clientWidth).toBeLessThanOrEqual(width);
  await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  const titles = [...canvasElement.querySelectorAll<HTMLElement>(".ui-rep-v3-group .ui-row-title")];
  await expect(titles.length).toBeGreaterThan(0);
  for (const name of titles) {
    const box = name.getBoundingClientRect();
    await expect(box.left >= 0 && box.right <= root.clientWidth).toBe(true);
    await expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
  }
  const long = titles.find((name) => name.textContent.includes("Contributions"));
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
