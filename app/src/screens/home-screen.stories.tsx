import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, waitFor, within } from "storybook/test";
import { attentionRows, CashHome, HomeScreen } from "./HomeScreen";
import { sampleCashMonths, sampleQuietCashMonths } from "../dev/cash-sample";
import { HOME_NEXT_MONTH_SAMPLE, NEXT_MONTH_TODAY } from "../dev/home-next-month-sample";
import { HomeNextMonth } from "./home-next-month";
import { shiftMonthKey } from "../period";
import { israelToday } from "../ui/date-math";
import { StoryRoute } from "../ui/story-route";
import { BandCompany } from "../ui/top-band";
import { exampleOnBand } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const HomeLoading: Story = {
  render: () => (
    <StoryRoute entry="/?preview=loading" tabs>
      <HomeScreen example={exampleOnBand} />
    </StoryRoute>
  ),
};

// FLOW-321. The pending card on Home: a row to Review and a row to Unpaid, each only when it has items.
function AttentionHome({ pending, unpaidCount, unpaidGross }: { pending: number; unpaidCount: number; unpaidGross: bigint }) {
  const currentKey = israelToday().slice(0, 7);
  return (
    <StoryRoute entry="/" tabs>
      <CashHome
        data={sampleCashMonths()}
        monthKey={currentKey}
        currentKey={currentKey}
        previewing={false}
        search=""
        attention={attentionRows({ pending, unpaidCount, unpaidGross, search: "" })}
        example={exampleOnBand}
        onStepMonth={() => undefined}
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

/** FLOW-364: Home's band with the month, its figures, the split card and the attention box. Invented figures. */
function CashHomeStory({ monthBack = 0, attention = true, initialDrawerOpen = false, quiet = false, offlineSince = null, recurringTip = false, late = recurringTip ? 1 : 0, forecast = null, forecastPending = false }: { monthBack?: number; attention?: boolean; initialDrawerOpen?: boolean; quiet?: boolean; offlineSince?: number | null; recurringTip?: boolean; late?: number; forecast?: bigint | null; forecastPending?: boolean }) {
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
        attention={attention ? attentionRows({ pending: 7, unpaidCount: 3, unpaidGross: 460_000n, missingCount: late, search: "" }) : []}
        example={exampleOnBand}
        onStepMonth={() => undefined}
        initialDrawerOpen={initialDrawerOpen}
        offlineSince={offlineSince}
        recurringTip={recurringTip}
        lateRecurring={late}
        forecast={forecast}
        forecastPending={forecastPending}
        company={recurringTip ? <BandCompany name="Acme Test Co" onOpen={() => undefined} /> : undefined}
      />
    </StoryRoute>
  );
}

/** FLOW-990 (board HomeNextMonth): next month's card and chart after the split card. Invented dollar figures. */
export const HomeNextMonthBlock: Story = {
  name: "Home, next month after the split card",
  render: () => (
    <StoryRoute entry="/" tabs>
      <CashHome
        data={HOME_NEXT_MONTH_SAMPLE.cash}
        monthKey={NEXT_MONTH_TODAY.slice(0, 7)}
        currentKey={NEXT_MONTH_TODAY.slice(0, 7)}
        previewing={false}
        search=""
        attention={attentionRows({ pending: 2, unpaidCount: 0, unpaidGross: 0n, search: "" })}
        example={exampleOnBand}
        onStepMonth={() => undefined}
        nextMonth={<HomeNextMonth today={NEXT_MONTH_TODAY} currency="USD" sample={HOME_NEXT_MONTH_SAMPLE} />}
      />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(canvasElement.querySelector("#home-next-title")?.textContent).toBe("החודש הבא");
    });
    await expect(canvasElement.querySelector(".ui-fc-card")).not.toBeNull();
    await expect(canvasElement.querySelector(".ui-fc-chart")).not.toBeNull();
  },
};

/** The current month, with the attention box and the split card. A first-time owner: no קבועים tip (FLOW-1015). */
export const HomeCurrent: Story = { render: () => <CashHomeStory /> };

/** FLOW-1015: a returning owner (one with recurring rows) sees the קבועים tip once, the count's sentence while a bill is late. Live Home has the company on the band, so the bubble opens over it. */
export const HomeRecurringTip: Story = { render: () => <CashHomeStory recurringTip /> };

/** FLOW-1017: three recurring bills late: their count on the band's קבועים icon, their row, and כל הקבועים at the box's foot. */
export const HomeLateRecurring: Story = {
  render: () => <CashHomeStory late={3} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findByRole("link", { name: "קבועים, 3 לא הגיעו" })).querySelector(".ui-band-count")?.textContent).toBe("3");
    await expect(canvas.getByRole("link", { name: "כל הקבועים" })).toHaveAttribute("href", "/recurring");
  },
};

/** The story's signal that the forecast's read answered (true) or is on its way again (false). */
const FORECAST_EVENT = "story-forecast";

/** The forecast row while its read is on its way, and once it answers on FORECAST_EVENT. Invented figure. */
function ForecastArrivesStory() {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const on = (event: Event) => {
      setArrived(event instanceof CustomEvent && event.detail === true);
    };
    window.addEventListener(FORECAST_EVENT, on);
    return () => {
      window.removeEventListener(FORECAST_EVENT, on);
    };
  }, []);
  return <CashHomeStory forecast={arrived ? 1_250_000n : null} forecastPending={!arrived} />;
}

/**
 * FLOW-1031: Home reads the forecast after it paints (FLOW-1019), so until the read answers the forecast row
 * keeps its place, a bar for its figure. The attention box sits where it will stay when the figure lands.
 */
export const HomeForecastPending: Story = {
  name: "Home, forecast row kept while it loads",
  render: () => <ForecastArrivesStory />,
  play: async ({ canvasElement }) => {
    // The layout's own offsets: the page's enter motion moves the box for a moment, the layout does not.
    const attentionTop = () => {
      const box = canvasElement.querySelector(".ui-home-attention");
      if (!(box instanceof HTMLElement)) throw new Error("the attention box is not drawn");
      let top = 0;
      for (let node: Element | null = box; node instanceof HTMLElement; node = node.offsetParent) top += node.offsetTop;
      return top;
    };
    await waitFor(async () => {
      await expect(canvasElement.querySelector(".ui-skel-forecast-value")).not.toBeNull();
    });
    // Measured once the type has loaded: a font swap moves the page on its own.
    await document.fonts.ready;
    const before = attentionTop();
    window.dispatchEvent(new CustomEvent(FORECAST_EVENT, { detail: true }));
    const canvas = within(canvasElement);
    await canvas.findByRole("link", { name: "תזרים צפוי לסוף החודש" });
    await expect(attentionTop()).toBe(before);
    // Back to the read on its way, the state this story shows.
    window.dispatchEvent(new CustomEvent(FORECAST_EVENT, { detail: false }));
    await waitFor(async () => {
      await expect(canvasElement.querySelector(".ui-skel-forecast-value")).not.toBeNull();
    });
    await expect(attentionTop()).toBe(before);
  },
};

/** FLOW-958: offline, the last figures stay, and a line in the band says when they were read. */
export const HomeOffline: Story = { render: () => <CashHomeStory offlineSince={Date.UTC(2026, 9, 26, 7, 41)} /> };

/** FLOW-958: the read failed on the server: the band says so, with נסו שוב and צריך עזרה?. */
export const HomeFailed: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error-server" tabs>
      <HomeScreen />
    </StoryRoute>
  ),
};

/** FLOW-958: the read failed with no network: the band says so in the network's words. */
export const HomeFailedOffline: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error" tabs>
      <HomeScreen />
    </StoryRoute>
  ),
};

/** A past month: the darker band, "חזרה ל…" and no forecast or box. */
export const HomePast: Story = { render: () => <CashHomeStory monthBack={1} attention={false} /> };

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
