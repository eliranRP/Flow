import type { Dashboard } from "@flow/shared";
import { type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { HomeBooks, HomeScreen } from "./HomeScreen";
import { presetPeriod } from "../period";
import { Banner } from "../ui/banner";
import { OfflineIcon } from "../ui/icons";
import { TextLink } from "../ui/text-link";
import { StoryRoute } from "../ui/story-route";
import { at320, dark, ExampleBar, exampleOnBand, sampleDashboard } from "../ui/screen-stories-support";

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
    <StoryRoute entry="/" tabs reviewCount={7}>
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
    <StoryRoute entry="/" tabs reviewCount={pending}>
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

const homeAt320 = { parameters: { viewport: { defaultViewport: "flow320" } } };
const homeDark = { globals: { theme: "dark" } };

export const HomeAttentionBoth: Story = {
  name: "Home attention, review and unpaid",
  render: () => <AttentionHome pending={7} unpaidCount={3} unpaidGross={2_340_000n} />,
};
export const HomeAttentionBothDark: Story = { ...HomeAttentionBoth, name: "Home attention, review and unpaid, dark", ...homeDark };
export const HomeAttentionBoth320: Story = { ...HomeAttentionBoth, name: "Home attention, review and unpaid, 320", ...homeAt320 };
export const HomeAttentionBothDark320: Story = {
  ...HomeAttentionBoth,
  name: "Home attention, review and unpaid, dark, 320",
  ...homeDark,
  ...homeAt320,
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
export const HomeAttentionSingular320: Story = { ...HomeAttentionSingular, name: "Home attention, one of each, 320", ...homeAt320 };

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
    <StoryRoute entry="/" tabs reviewCount={7}>
      <SampleHome refreshing />
    </StoryRoute>
  ),
};

export const OfflineCached: Story = {
  render: () => (
    <StoryRoute entry="/" tabs reviewCount={7}>
      <SampleHome
        notice={
          <Banner
            icon={<OfflineIcon />}
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

// Profit by period (decision 0141, plan option A): Home on the period bar, the project with its own
// period and the summary first, the "לפי חודש" page, and Unpaid with a mark that stays (FLOW-330).

const periodDashboard: Dashboard = {
  ...sampleDashboard,
  review_count: 2,
  projects: [
    { id: "p-a", name: "וילה לדוגמה", status: "active", income_agorot: 36_600_000n, direct_agorot: 26_540_000n, shared_agorot: 0n, profit_before_shared_agorot: 10_060_000n, profit_agorot: 10_060_000n, by_currency: [] },
    { id: "p-b", name: "שיפוץ משרדים לדוגמה עם שם ארוך שנחתך בסוף השורה", status: "active", income_agorot: 4_000_000n, direct_agorot: 4_965_000n, shared_agorot: 0n, profit_before_shared_agorot: -965_000n, profit_agorot: -965_000n, by_currency: [] },
    { id: "p-c", name: "בניין מגורים לדוגמה", status: "active", income_agorot: 12_000_000n, direct_agorot: 8_810_000n, shared_agorot: 0n, profit_before_shared_agorot: 3_190_000n, profit_agorot: 3_190_000n, by_currency: [] },
    { id: "p-d", name: "גג לדוגמה", status: "active", income_agorot: 0n, direct_agorot: 210_000n, shared_agorot: 0n, profit_before_shared_agorot: -210_000n, profit_agorot: -210_000n, by_currency: [] },
    { id: "p-e", name: "מחסן לדוגמה", status: "active", income_agorot: 2_000_000n, direct_agorot: 1_400_000n, shared_agorot: 0n, profit_before_shared_agorot: 600_000n, profit_agorot: 600_000n, by_currency: [] },
    { id: "p-f", name: "חנות לדוגמה", status: "active", income_agorot: 900_000n, direct_agorot: 600_000n, shared_agorot: 0n, profit_before_shared_agorot: 300_000n, profit_agorot: 300_000n, by_currency: [] },
    { id: "p-g", name: "פרויקט בלי תנועות בתקופה", status: "active", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n, by_currency: [] },
  ],
};

function PeriodHome() {
  return (
    <StoryRoute entry="/" tabs reviewCount={2}>
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

export const HomePeriod: Story = { name: "Home, period bar, 3 months", render: () => <PeriodHome /> };
export const HomePeriodDark: Story = { ...HomePeriod, name: "Home, period bar, 3 months, dark", ...dark };
export const HomePeriod320: Story = { ...HomePeriod, name: "Home, period bar, 3 months, 320", ...at320 };
export const HomePeriodDark320: Story = { ...HomePeriod, name: "Home, period bar, 3 months, dark, 320", ...dark, ...at320 };
