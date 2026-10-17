import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor } from "@storybook/test";
import { attentionRows, CashHome, HomeScreen } from "./HomeScreen";
import { sampleCashMonths, sampleQuietCashMonths } from "../dev/cash-sample";
import { shiftMonthKey } from "../period";
import { israelToday } from "../ui/date-math";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar, exampleOnBand } from "../ui/screen-stories-support";

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
