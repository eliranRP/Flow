import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { REPORTS_BALANCE, REPORTS_TODAY } from "../dev/reports-sample";
import type { BalanceSheet } from "../reports";
import { DocumentIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { StoryRoute } from "../ui/story-route";
import { BalanceReportScreen } from "./reports-balance-screen";
import { hintFigures, reportHint } from "./reports-parts";

/**
 * FLOW-171: the balance sheet's account rows with a long Latin name: they break after "/" and stay inside the screen.
 * FLOW-1108: a report row with an icon in its lead column.
 */
const meta = {
  title: "Screens/Reports/Rows",
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

/**
 * FLOW-1098, FLOW-1108: a report row that adds an icon before its name. The report grid gives the icon a lead column
 * across both lines, the name and the amount the first line beside it and the hint the second, so nothing auto-places.
 */
export const LeadIcon320: Story = {
  name: "Report row · an icon in the lead column at 320",
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => (
    <StoryRoute entry="/reports/pnl?view=project">
      <div className="ui-rep-page">
        <section className="ui-month ui-rep-v3-group" aria-label="לפי פרויקט">
          <List>
            <ListRow
              variant="project"
              icon={<DocumentIcon size={24} />}
              title="Elm Tower"
              wrapTitle
              hint={reportHint(hintFigures([["הכנסות", 3_000_000n], ["הוצאות", 1_700_000n]], "USD"), 40)}
              href="/reports/pnl?view=project"
              chevron
              currency="USD"
              agorot={1_300_000n}
            />
          </List>
        </section>
      </div>
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLElement>(".ui-rep-v3-group .ui-row");
    const icon = row?.querySelector<HTMLElement>(".ui-row-icon");
    const title = row?.querySelector<HTMLElement>(".ui-row-title");
    const hint = row?.querySelector<HTMLElement>(".ui-row-hint");
    if (row == null || icon == null || title == null || hint == null) throw new Error("the row and its parts");
    await expect(getComputedStyle(icon).gridArea).toBe("lead");
    const iconBox = icon.getBoundingClientRect();
    // RTL: the lead column is at the right; the name and the hint start left of it, the hint under the name.
    await expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(iconBox.left + 1);
    await expect(hint.getBoundingClientRect().right).toBeLessThanOrEqual(iconBox.left + 1);
    await expect(hint.getBoundingClientRect().top).toBeGreaterThanOrEqual(title.getBoundingClientRect().bottom - 1);
    const root = canvasElement.ownerDocument.documentElement;
    await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  },
};
