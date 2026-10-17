import type { Dashboard } from "@flow/shared";
import { type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, waitFor, within } from "@storybook/test";
import { attentionRows, CashHome, HomeBooks, HomeScreen } from "./HomeScreen";
import { sampleCashMonths, sampleQuietCashMonths } from "../dev/cash-sample";
import { shiftMonthKey } from "../period";
import { israelToday } from "../ui/date-math";
import { presetPeriod } from "../period";
import { Banner } from "../ui/banner";
import { TextLink } from "../ui/text-link";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar, exampleOnBand, sampleDashboard } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const HomeEmpty: Story = {
  render: () => (
    <StoryRoute entry="/?preview=empty" tabs>
      <HomeScreen example={exampleOnBand} />
    </StoryRoute>
  ),
};

export const HomeLoading: Story = {
  render: () => (
    <StoryRoute entry="/?preview=loading" tabs>
      <HomeScreen example={exampleOnBand} />
    </StoryRoute>
  ),
};

export const HomeOffline: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error" tabs>
      <ExampleBar />
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeServerError: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error-server" tabs>
      <ExampleBar />
      <HomeScreen />
    </StoryRoute>
  ),
};

export const HomeBooksMonth: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={sampleDashboard}
        previewing={false}
        search=""
        unpaidGross={2_340_000n}
        unpaidCount={3}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

// FLOW-321. The pending card on Home: a row to Review and a row to Unpaid, each only when it has items.
function AttentionHome({ pending, unpaidCount, unpaidGross }: { pending: number; unpaidCount: number; unpaidGross: bigint }) {
  return (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={{ ...sampleDashboard, review_count: pending }}
        previewing={false}
        search=""
        unpaidGross={unpaidGross}
        unpaidCount={unpaidCount}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  );
}


export const HomeAttentionBoth: Story = {
  name: "Home attention, review and unpaid",
  render: () => <AttentionHome pending={7} unpaidCount={3} unpaidGross={2_340_000n} />,
};
export const HomeAttentionReviewOnly: Story = {
  name: "Home attention, review only",
  render: () => <AttentionHome pending={7} unpaidCount={0} unpaidGross={0n} />,
};
export const HomeAttentionUnpaidOnly: Story = {
  name: "Home attention, unpaid only",
  render: () => <AttentionHome pending={0} unpaidCount={3} unpaidGross={2_340_000n} />,
};
export const HomeAttentionSingular: Story = {
  name: "Home attention, one of each",
  render: () => <AttentionHome pending={1} unpaidCount={1} unpaidGross={468_000n} />,
};

export const HomeLongHero: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={{ ...sampleDashboard, income_agorot: 12_345_678_900n, expense_agorot: 0n, net_profit_agorot: 12_345_678_900n }}
        previewing={false}
        search=""
        unpaidGross={0n}
        unpaidCount={0}
        period={{ kind: "all", from: null, to: null }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

function SampleHome({ refreshing = false, notice }: { refreshing?: boolean; notice?: ReactNode } = {}) {
  return (
    <HomeBooks
      data={sampleDashboard}
      previewing={false}
      search=""
      unpaidGross={2_340_000n}
      unpaidCount={3}
      period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
      onPeriod={() => undefined}
      example={exampleOnBand}
      refreshing={refreshing}
      notice={notice}
    />
  );
}

export const PullToRefresh: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <SampleHome refreshing />
    </StoryRoute>
  ),
};

export const OfflineCached: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <SampleHome
        notice={
          <Banner
            title={<>אין חיבור · נתונים מ-<bdi dir="ltr">09:12</bdi></>}
            action={<TextLink onClick={() => undefined}>ניסיון חוזר</TextLink>}
          />
        }
      />
    </StoryRoute>
  ),
};

const usdOnlyDashboard: Dashboard = {
  ...sampleDashboard,
  base_currency: "USD",
  income_agorot: 0n,
  expense_agorot: 0n,
  net_profit_agorot: 0n,
  by_currency: [{
    currency: "USD",
    income_minor: 500_000n,
    direct_minor: 200_000n,
    shared_minor: 0n,
    overhead_minor: 0n,
    expense_minor: 200_000n,
    net_profit_minor: 300_000n,
    count: 3,
    // FLOW-504: the change pill reads these (0147).
    prev_income_minor: 400_000n,
    prev_expense_minor: 200_000n,
    prev_net_profit_minor: 200_000n,
  }],
  projects: [{
    id: "usd1",
    name: "Cedar Lot",
    status: "active",
    income_agorot: 0n,
    direct_agorot: 0n,
    shared_agorot: 0n,
    profit_before_shared_agorot: 0n,
    profit_agorot: 0n,
    by_currency: [{
      currency: "USD",
      income_minor: 500_000n,
      direct_minor: 200_000n,
      shared_minor: 0n,
      profit_minor: 300_000n,
    }],
  }],
};

const mixedCurrencyDashboard: Dashboard = {
  ...sampleDashboard,
  by_currency: [
    { currency: "ILS", income_minor: 100_000n, direct_minor: 40_000n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 40_000n, net_profit_minor: 60_000n, count: 2 },
    { currency: "USD", income_minor: 200_000n, direct_minor: 50_000n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 50_000n, net_profit_minor: 150_000n, count: 2 },
  ],
};

export const HomeUsdOnly: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={usdOnlyDashboard}
        previewing={false}
        search=""
        unpaidGross={0n}
        unpaidCount={0}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};


export const HomeMixedCurrency: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={mixedCurrencyDashboard}
        previewing={false}
        search=""
        unpaidGross={0n}
        unpaidCount={0}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

// FLOW-339: a profit in shekels and a loss in dollars; the label names both.
export const HomeMixedSigns: Story = {
  render: () => (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={{
          ...mixedCurrencyDashboard,
          by_currency: [
            { currency: "ILS", income_minor: 100_000n, direct_minor: 40_000n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 40_000n, net_profit_minor: 60_000n, count: 2 },
            { currency: "USD", income_minor: 50_000n, direct_minor: 175_000n, shared_minor: 0n, overhead_minor: 0n, expense_minor: 175_000n, net_profit_minor: -125_000n, count: 2 },
          ],
        }}
        previewing={false}
        search=""
        unpaidGross={0n}
        unpaidCount={0}
        period={{ kind: "month", from: "2026-09-01", to: "2026-09-28" }}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};


// Profit by period (decision 0141, plan option A): Home on the period bar, the project with its own
// period and the summary first, the "לפי חודש" page, and Unpaid with a mark that stays (FLOW-330).

const periodDashboard: Dashboard = {
  ...sampleDashboard,
  review_count: 2,
  projects: [
    { id: "p-a", name: "וילה לדוגמה", status: "active", income_agorot: 36_600_000n, direct_agorot: 26_540_000n, shared_agorot: 0n, profit_before_shared_agorot: 10_060_000n, profit_agorot: 10_060_000n, by_currency: [] },
    { id: "p-b", name: "שיפוץ משרדים לדוגמה עם שם ארוך שעובר לשורה שנייה", status: "active", income_agorot: 4_000_000n, direct_agorot: 4_965_000n, shared_agorot: 0n, profit_before_shared_agorot: -965_000n, profit_agorot: -965_000n, by_currency: [] },
    { id: "p-c", name: "בניין מגורים לדוגמה", status: "active", income_agorot: 12_000_000n, direct_agorot: 8_810_000n, shared_agorot: 0n, profit_before_shared_agorot: 3_190_000n, profit_agorot: 3_190_000n, by_currency: [] },
    { id: "p-d", name: "גג לדוגמה", status: "active", income_agorot: 0n, direct_agorot: 210_000n, shared_agorot: 0n, profit_before_shared_agorot: -210_000n, profit_agorot: -210_000n, by_currency: [] },
    { id: "p-e", name: "מחסן לדוגמה", status: "active", income_agorot: 2_000_000n, direct_agorot: 1_400_000n, shared_agorot: 0n, profit_before_shared_agorot: 600_000n, profit_agorot: 600_000n, by_currency: [] },
    { id: "p-f", name: "חנות לדוגמה", status: "active", income_agorot: 900_000n, direct_agorot: 600_000n, shared_agorot: 0n, profit_before_shared_agorot: 300_000n, profit_agorot: 300_000n, by_currency: [] },
    { id: "p-g", name: "פרויקט בלי תנועות בתקופה", status: "active", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n, by_currency: [] },
  ],
};

function PeriodHome() {
  return (
    <StoryRoute entry="/" tabs>
      <HomeBooks
        data={periodDashboard}
        previewing={false}
        search=""
        unpaidGross={1_740_000n}
        unpaidCount={2}
        period={presetPeriod("months3")}
        onPeriod={() => undefined}
        example={exampleOnBand}
      />
    </StoryRoute>
  );
}

export const HomePeriod: Story = { name: "Home, period pill, 3 months", render: () => <PeriodHome /> };

/** FLOW-355 (A): on a 375x667 phone the first project row shows above the tab bar; the review and invoices rows follow two projects. */
export const HomePeriodSmallPhone: Story = {
  ...HomePeriod,
  name: "Home, period pill, 375x667",
  parameters: { viewport: { defaultViewport: "flow375-se" } },
};

/** The pill opens the period sheet. */
export const HomePeriodSheet: Story = {
  ...HomePeriod,
  name: "Home, period pill opens the sheet",
  play: async ({ canvasElement }) => {
    await fireEvent.click(within(canvasElement).getByRole("button", { name: /בחירת תקופה$/ }));
    await expect(await within(document.body).findByRole("dialog", { name: "תקופה" })).toBeVisible();
  },
};

/** FLOW-364: Home's band with the month, its figures, the split card and the attention box. Invented figures. */
function CashHomeStory({ monthBack = 0, attention = true, initialDrawerOpen = false, quiet = false }: { monthBack?: number; attention?: boolean; initialDrawerOpen?: boolean; quiet?: boolean }) {
  const data = quiet ? sampleQuietCashMonths() : sampleCashMonths();
  const currentKey = israelToday().slice(0, 7);
  return (
    <StoryRoute entry="/" tabs>
      <CashHome
        data={data}
        monthKey={shiftMonthKey(currentKey, -monthBack)}
        currentKey={currentKey}
        previewing={false}
        search=""
        attention={attention ? attentionRows({ pending: 7, unpaidCount: 3, unpaidGross: 460_000n, search: "" }) : []}
        example={exampleOnBand}
        onStepMonth={() => undefined}
        initialDrawerOpen={initialDrawerOpen}
      />
    </StoryRoute>
  );
}

/** The current month, with the attention box and the split card. */
export const HomeCurrent: Story = { render: () => <CashHomeStory /> };

/** Nothing waiting: the attention box is not drawn. */
export const HomeNoBox: Story = { render: () => <CashHomeStory attention={false} /> };

/** A past month: the darker band, "חזרה ל…" and no forecast or box. */
export const HomePast: Story = { render: () => <CashHomeStory monthBack={1} attention={false} /> };

/** The month drawer open on the selected month's year. */
export const HomeDrawer: Story = { render: () => <CashHomeStory initialDrawerOpen /> };

/** A month with nothing moved yet: the figures read zero. */
export const HomeQuiet: Story = { render: () => <CashHomeStory quiet attention={false} /> };

/** Scrolled past the band: the compact bar pins the month and the arrows, and the band's figures fade away (FLOW-364). */
export const HomeScrolled: Story = {
  render: () => <CashHomeStory />,
  play: async ({ canvasElement }) => {
    window.scrollTo(0, 400);
    const bar = await waitFor(() => canvasElement.ownerDocument.querySelector<HTMLElement>(".ui-compact-bar-band"));
    if (bar == null) throw new Error("the compact bar is not drawn");
    await expect(bar).toBeInTheDocument();
    // FLOW-374: the figure is whole inside the bar (the bar is 64px, the net sits in its centre).
    const net = bar.querySelector(".ui-compact-bar-centre-net");
    if (net == null) throw new Error("the bar's figure is not drawn");
    const barBox = bar.getBoundingClientRect();
    const netBox = net.getBoundingClientRect();
    await expect(netBox.bottom).toBeLessThanOrEqual(barBox.bottom);
    await expect(netBox.top).toBeGreaterThanOrEqual(barBox.top);
    window.scrollTo(0, 0);
  },
};
