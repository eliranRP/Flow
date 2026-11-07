import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  REPORTS_BALANCE,
  REPORTS_BALANCE_SUSPENSE,
  REPORTS_BY_PROJECT,
  REPORTS_CEDAR,
  REPORTS_EMPTY,
  REPORTS_MONTHS,
  REPORTS_OCTOBER,
  REPORTS_PROJECT_IDS,
  REPORTS_PROJECT_SHEETS,
  REPORTS_STATEMENT,
  REPORTS_TODAY,
} from "../dev/reports-sample";
import { ExampleBar, storyBody } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ToastProvider } from "../ui/toast";
import { CATEGORY_ROWS, CategoryLinesView, inView, line, titleLines } from "./report-lines-story-support";
import { BalanceReportScreen, type BalanceSample } from "./reports-balance-screen";
import { ReportsHubScreen, type HubSample } from "./reports-hub-screen";
import { PnlReportScreen, type PnlSample } from "./reports-screen";

/**
 * FLOW-1045 (boards V3-Reports, V3-Report and its variants, V3-States): the hub, the P&L and the balance
 * sheet with their views and drill-downs; FLOW-161: the category drill-down and the Home card.
 */
const meta = {
  title: "Screens/Reports",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const CEDAR = REPORTS_PROJECT_IDS.cedar;
const OAK_SHEET = REPORTS_PROJECT_SHEETS.find((sheet) => sheet.project_id === REPORTS_PROJECT_IDS.oak);
const phone320 = { globals: { viewport: { value: "flow320", isRotated: false } } };
const phone360 = { globals: { viewport: { value: "flow360", isRotated: false } } };
const phone374 = { globals: { viewport: { value: "flow374", isRotated: false } } };
const phone393 = { globals: { viewport: { value: "flow393", isRotated: false } } };

function Hub({ entry = "/reports", sample = {} }: { entry?: string; sample?: Partial<HubSample> }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <ReportsHubScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, byProject: REPORTS_BY_PROJECT, months: REPORTS_MONTHS, balance: REPORTS_BALANCE, ...sample }} />
    </StoryRoute>
  );
}

function Pnl({ entry = "/reports/pnl", sample = {} }: { entry?: string; sample?: Partial<PnlSample> }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <PnlReportScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, byProject: REPORTS_BY_PROJECT, months: REPORTS_MONTHS, ...sample }} />
    </StoryRoute>
  );
}

function Balance({ entry = "/reports/balance", sample = {} }: { entry?: string; sample?: Partial<BalanceSample> }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <BalanceReportScreen sample={{ today: REPORTS_TODAY, balance: REPORTS_BALANCE, projects: REPORTS_BY_PROJECT, projectSheets: REPORTS_PROJECT_SHEETS, ...sample }} />
    </StoryRoute>
  );
}

/** Nothing wider than the screen: the page never scrolls sideways. */
async function fits(canvasElement: HTMLElement) {
  const root = canvasElement.ownerDocument.documentElement;
  await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
}

/**
 * FLOW-1082 (the owner, 2026-11-07, option A): every report row's hint with figures is one line and whole, with no
 * ellipsis. From 374 it shows the full figures; below 374 the short ones ($30K) (FLOW-1098), on its own line under the
 * name and the amount, across the row up to the chevron's column. Measured in Rubik, once the fonts are in.
 */
async function hintsWhole(canvasElement: HTMLElement) {
  // Rubik is swapped in (font-display: swap); `ready` can resolve before the first layout asks for it.
  await canvasElement.ownerDocument.fonts.load("400 13px Rubik");
  await canvasElement.ownerDocument.fonts.ready;
  const hints = [...canvasElement.querySelectorAll<HTMLElement>(".ui-rep-v3-group .ui-rep-hint-text")].filter((hint) => hint.querySelector(".ui-rep-hint-short") != null);
  await expect(hints.length).toBeGreaterThan(0);
  const narrow = canvasElement.ownerDocument.documentElement.clientWidth < 374;
  for (const hint of hints) {
    await expect(getComputedStyle(hint).whiteSpace).toBe("nowrap");
    await expect(hint.scrollWidth).toBeLessThanOrEqual(hint.clientWidth);
    await expect(hint.getBoundingClientRect().height).toBeLessThanOrEqual(parseFloat(getComputedStyle(hint).lineHeight) + 1);
    const short = hint.querySelector<HTMLElement>(".ui-rep-hint-short");
    await expect(short == null ? "none" : getComputedStyle(short).display).toBe(narrow ? "inline" : "none");
    const row = hint.closest<HTMLElement>(".ui-row");
    const line = hint.closest<HTMLElement>(".ui-row-hint");
    const chevron = row?.querySelector<HTMLElement>(".ui-row-chevron");
    const title = row?.querySelector<HTMLElement>(".ui-row-title");
    if (row == null || line == null || chevron == null || title == null) throw new Error("a report row without its parts");
    const box = line.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const chevronBox = chevron.getBoundingClientRect();
    // Under the name and the amount, from the row's start to the chevron's column.
    await expect(box.top).toBeGreaterThanOrEqual(title.getBoundingClientRect().bottom - 1);
    await expect(box.top).toBeGreaterThanOrEqual(chevronBox.top);
    await expect(Math.abs(box.right - rowBox.right)).toBeLessThanOrEqual(1);
    await expect(box.left).toBeLessThanOrEqual(chevronBox.right + parseFloat(getComputedStyle(row).columnGap) + 1);
    await expect(box.left).toBeGreaterThanOrEqual(chevronBox.right - 1);
  }
}

// ---- The hub -------------------------------------------------------------------------------------

/** The two reports' cards, each with its figure, a decorative chart and two facts, then the three breakdowns. */
export const HubStory: Story = {
  name: "Hub",
  render: () => <Hub />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /רווח והפסד לפי פרויקט/ })).toHaveAttribute("href", "/reports/pnl?view=project");
    for (const chart of canvasElement.querySelectorAll(".ui-rep-hub-bars, .ui-rep-hub-split")) await expect(chart).toHaveAttribute("aria-hidden", "true");
    await fits(canvasElement);
  },
};

export const Hub320: Story = { name: "Hub · 320", ...phone320, render: () => <Hub />, play: async ({ canvasElement }) => { await fits(canvasElement); } };
export const HubLoading: Story = { name: "Hub · loading", render: () => <Hub sample={{ phase: { kind: "loading" } }} /> };
export const HubFailed: Story = { name: "Hub · failed to load", render: () => <Hub sample={{ phase: { kind: "error", offline: false } }} /> };
export const HubOffline: Story = { name: "Hub · offline", render: () => <Hub sample={{ offlineSince: Date.parse("2026-10-31T07:41:00Z") }} /> };
/** One read failed: the P&L card that loaded stays, the balance card shows its retry line. */
export const HubBalanceFailed: Story = {
  name: "Hub · P&L loaded, balance failed",
  render: () => <Hub sample={{ balance: undefined, failed: ["balance"] }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /רווח והפסד.*\$29,000/ })).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: /מאזן.*\$285,000/ })).toBeNull();
    await expect(canvas.getAllByRole("button", { name: "נסו שוב" })).toHaveLength(1);
    await fits(canvasElement);
  },
};

/** The months read failed: the cards stay, the P&L card shows the retry line in place of its chart. */
export const HubMonthsFailed: Story = {
  name: "Hub · balance loaded, months failed",
  render: () => <Hub sample={{ months: undefined, failed: ["months"] }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /מאזן.*\$285,000/ })).toBeInTheDocument();
    await expect(canvasElement.querySelector(".ui-rep-hub-bars")).toBeNull();
    await expect(canvas.getAllByRole("button", { name: "נסו שוב" })).toHaveLength(1);
    await fits(canvasElement);
  },
};

export const HubEmpty: Story = { name: "Hub · empty", render: () => <Hub sample={{ statement: REPORTS_EMPTY, balance: { ...REPORTS_BALANCE, currencies: [] } }} /> };

// ---- The P&L -------------------------------------------------------------------------------------

/** By category: the band with the period pill and the net, the review card, the view control, the sections. */
export const ProfitAndLoss: Story = {
  name: "P&L · by category",
  render: () => <Pnl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("30% מההכנסות")).toBeInTheDocument();
    await expect(canvas.getByRole("radio", { name: "קטגוריה" })).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByRole("link", { name: /ריבית משכנתא/ })).toBeInTheDocument();
  },
};

export const ProfitAndLoss320: Story = { name: "P&L · by category at 320", ...phone320, render: () => <Pnl />, play: async ({ canvasElement }) => { await fits(canvasElement); } };

/** By project: each project's net, income and expenses under it; the general expenses in their own group. */
export const ByProject: Story = {
  name: "P&L · by project",
  render: () => <Pnl entry="/reports/pnl?view=project" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "כלליות · לא פרויקט" })).toBeInTheDocument();
    await fits(canvasElement);
  },
};

export const ByMonth: Story = { name: "P&L · by month", render: () => <Pnl entry="/reports/pnl?view=month" /> };

/** FLOW-1082: at 320 a row's hint stays on one line with short figures ($9.6K), none cut. */
export const ByMonth320: Story = {
  name: "P&L · by month at 320",
  ...phone320,
  render: () => <Pnl entry="/reports/pnl?view=month" />,
  play: async ({ canvasElement }) => {
    await hintsWhole(canvasElement);
    await fits(canvasElement);
  },
};

/** A project with a $10 net: a small non-zero share reads "פחות מ־1%", never 0% (FLOW-1083). */
const SMALL_PROJECT = {
  key: "a0000000-0000-4000-8000-000000000180",
  project_id: "a0000000-0000-4000-8000-000000000180",
  name: "Ash Row",
  currencies: [{ currency: "USD", income_minor: 100_000n, expense_minor: 99_000n, net_minor: 1_000n, income: [], expense: [], kept_out: [] }],
};

/** A $20M project, so the $130,000 row below is under 1% of its group and its amount is wide (a narrow hint column). */
const HUGE_PROJECT = {
  key: "a0000000-0000-4000-8000-000000000181",
  project_id: "a0000000-0000-4000-8000-000000000181",
  name: "Oak Ridge Estate",
  currencies: [{ currency: "USD", income_minor: 2_000_000_000n, expense_minor: 0n, net_minor: 2_000_000_000n, income: [], expense: [], kept_out: [] }],
};

/** FLOW-1082: a small row with a wide amount leaves a narrow hint column at 320; its figures must all stay whole. */
const WIDE_SMALL_PROJECT = {
  key: "a0000000-0000-4000-8000-000000000182",
  project_id: "a0000000-0000-4000-8000-000000000182",
  name: "Birch Court",
  currencies: [{ currency: "USD", income_minor: 14_000_000n, expense_minor: 1_000_000n, net_minor: 13_000_000n, income: [], expense: [], kept_out: [] }],
};

/** FLOW-1082, FLOW-1083: by project at 320, each hint whole, the small rows under 1%. */
export const ByProject320: Story = {
  name: "P&L · by project at 320",
  ...phone320,
  render: () => <Pnl entry="/reports/pnl?view=project" sample={{ byProject: { ...REPORTS_BY_PROJECT, projects: [...REPORTS_BY_PROJECT.projects, SMALL_PROJECT, HUGE_PROJECT, WIDE_SMALL_PROJECT] } }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("link", { name: /Ash Row/ }).textContent).toContain("פחות מ־1%");
    await hintsWhole(canvasElement);
    await fits(canvasElement);
  },
};

/** FLOW-1098: a project with nine-digit figures, the longest full line a row's hint shows. */
const NINE_DIGIT_PROJECT = {
  key: "a0000000-0000-4000-8000-000000000183",
  project_id: "a0000000-0000-4000-8000-000000000183",
  name: "Elm Tower",
  currencies: [{ currency: "USD", income_minor: 12_000_000_000n, expense_minor: 10_000_000_000n, net_minor: 2_000_000_000n, income: [], expense: [], kept_out: [] }],
};

function NineDigits() {
  return <Pnl entry="/reports/pnl?view=project" sample={{ byProject: { ...REPORTS_BY_PROJECT, projects: [...REPORTS_BY_PROJECT.projects, NINE_DIGIT_PROJECT] } }} />;
}

/** FLOW-1098: the full line "99% · הכנסות $120,000,000 · הוצאות $100,000,000" is cut at 360, so there it is short ($120M). */
export const ByProjectNineDigits360: Story = {
  name: "P&L · by project, nine-digit figures at 360",
  ...phone360,
  render: () => <NineDigits />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("link", { name: /Elm Tower/ }).textContent).toContain("הכנסות $120M · הוצאות $100M");
    await hintsWhole(canvasElement);
    await fits(canvasElement);
  },
};

/** FLOW-1098: from 374, the narrowest width it fits, the same line is in full and whole. */
export const ByProjectNineDigits374: Story = {
  name: "P&L · by project, nine-digit figures at 374",
  ...phone374,
  render: () => <NineDigits />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("link", { name: /Elm Tower/ }).textContent).toContain("הכנסות $120,000,000 · הוצאות $100,000,000");
    await hintsWhole(canvasElement);
    await fits(canvasElement);
  },
};

/** FLOW-1082: at 393 the same rows keep their full figures on one line under the name and the amount, none cut. */
export const ByProject393: Story = {
  name: "P&L · by project at 393",
  ...phone393,
  render: () => <Pnl entry="/reports/pnl?view=project" sample={{ byProject: { ...REPORTS_BY_PROJECT, projects: [...REPORTS_BY_PROJECT.projects, SMALL_PROJECT, HUGE_PROJECT, WIDE_SMALL_PROJECT] } }} />,
  play: async ({ canvasElement }) => {
    await hintsWhole(canvasElement);
    await fits(canvasElement);
  },
};

/** A project row drilled on the same screen: the band says its name and net, "‹ לפי פרויקט" returns. */
export const ProjectDrill: Story = {
  name: "P&L · a project drilled",
  render: () => <Pnl entry={`/reports/pnl?view=project&project=${CEDAR}`} sample={{ drilled: REPORTS_CEDAR }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "Cedar St" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "חזרה ללפי פרויקט" })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /לדף הפרויקט/ })).toBeInTheDocument();
  },
};

export const GeneralDrill: Story = { name: "P&L · the general expenses drilled", render: () => <Pnl entry="/reports/pnl?view=project&project=overhead" /> };

/** FLOW-1092: the pill sits between the month's chevrons; October is the newest, so the later one is off. */
export const MonthDrill: Story = {
  name: "P&L · a month drilled",
  render: () => <Pnl entry="/reports/pnl?view=month&month=2026-10" sample={{ drilled: REPORTS_OCTOBER }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /תנועות החודש/ })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "חודש קודם" })).not.toHaveAttribute("aria-disabled");
    await expect(canvas.getByRole("button", { name: "חודש הבא" })).toHaveAttribute("aria-disabled", "true");
  },
};

/** FLOW-1092 at 320: the month's pill opens the report's months; a pick stays in the drill, on that month. */
export const MonthDrillSheet320: Story = {
  name: "P&L · a month drilled · its months at 320",
  ...phone320,
  render: () => <Pnl entry="/reports/pnl?view=month&month=2026-09" sample={{ drilled: REPORTS_OCTOBER }} />,
  play: async ({ canvasElement }) => {
    await fits(canvasElement);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "ספטמבר 2026" }));
    const sheet = await storyBody(canvasElement).findByRole("dialog", { name: "חודש" });
    await expect(within(sheet).getByRole("radio", { name: "ספטמבר 2026" })).toBeChecked();
  },
};

/** FLOW-1102 at 320: the by-month read is still in, so neither chevron steps yet; each says why to a screen reader. */
export const MonthDrillMonthsLoading320: Story = {
  name: "P&L · a month drilled · its months loading at 320",
  ...phone320,
  render: () => <Pnl entry="/reports/pnl?view=month&month=2026-10" sample={{ drilled: REPORTS_OCTOBER, monthsRead: "loading" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "חודש קודם" })).toHaveAccessibleDescription("החודשים עוד נטענים");
    await expect(canvas.getByRole("button", { name: "חודש הבא" })).toHaveAccessibleDescription("החודשים עוד נטענים");
    await fits(canvasElement);
  },
};

/** FLOW-1102 at 320: the by-month read failed: one line says so, with its retry, above the month's groups. */
export const MonthDrillMonthsFailed320: Story = {
  name: "P&L · a month drilled · its months failed at 320",
  ...phone320,
  render: () => <Pnl entry="/reports/pnl?view=month&month=2026-10" sample={{ drilled: REPORTS_OCTOBER, monthsRead: "failed" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("לא הצלחנו לטעון את החודשים.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "נסו שוב" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "חודש קודם" })).toHaveAccessibleDescription("החודשים לא נטענו");
    await fits(canvasElement);
  },
};

/** Scrolled: the band bar slides in, and the view control docks into it; a pick there keeps it docked. */
export const Docked: Story = {
  name: "P&L · the view docked in the band bar",
  render: () => <Pnl entry="/reports/pnl?view=month" />,
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 600, behavior: "instant" });
    const dock = () => canvasElement.ownerDocument.querySelector(".ui-compact-dock");
    await waitFor(() => expect(dock()).toHaveAttribute("data-open"));
    await expect(canvasElement.querySelector(".ui-dock-slot")).toHaveAttribute("data-docked");
    await expect(within(dock() as HTMLElement).getByRole("radio", { name: "חודש" })).toHaveAttribute("aria-checked", "true");
    window.scrollTo({ top: 0, behavior: "instant" });
  },
};

/** The review card hidden on this device: its section folds to one line with הצגת הכול. */
export const AttentionHidden: Story = {
  name: "P&L · the review card hidden",
  render: () => {
    try {
      window.localStorage.setItem("flow.attention.reports", JSON.stringify({ review: "review:2" }));
    } catch {
      // No storage: the card shows.
    }
    return <Pnl />;
  },
};

/** Long content: eight projects, one with a long Latin name, at 320. */
export const ByProjectLong320: Story = {
  name: "P&L · by project, long names at 320",
  ...phone320,
  render: () => <Pnl entry="/reports/pnl?view=project" sample={{ byProject: { ...REPORTS_BY_PROJECT, projects: EIGHT_PROJECTS } }} />,
  play: async ({ canvasElement }) => {
    await hintsWhole(canvasElement);
    await fits(canvasElement);
  },
};

export const Empty: Story = { name: "P&L · empty period", render: () => <Pnl entry="/reports/pnl?period=last_month" sample={{ statement: REPORTS_EMPTY }} /> };
export const Loading: Story = { name: "P&L · loading", render: () => <Pnl sample={{ phase: { kind: "loading" } }} /> };
export const Failed: Story = { name: "P&L · failed to load", render: () => <Pnl sample={{ phase: { kind: "error", offline: false } }} /> };
export const Offline: Story = { name: "P&L · offline", render: () => <Pnl sample={{ offlineSince: Date.parse("2026-10-31T07:41:00Z") }} /> };

// ---- The balance sheet ---------------------------------------------------------------------------

export const BalanceSheet: Story = { name: "Balance sheet · assets", render: () => <Balance /> };
export const BalanceLiabilities: Story = { name: "Balance sheet · liabilities and equity", render: () => <Balance entry="/reports/balance?view=liabilities" /> };
export const BalanceSuspense: Story = { name: "Balance sheet · Suspense", render: () => <Balance sample={{ balance: REPORTS_BALANCE_SUSPENSE }} /> };

/** By project: each property's equity, then the rest; a property row drills in. */
export const BalanceByProject: Story = {
  name: "Balance sheet · by project",
  render: () => <Balance entry="/reports/balance?view=project" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("בנק ושאר")).toBeInTheDocument();
    await fits(canvasElement);
  },
};

/** At 320 each row's line, led by its share of the group (FLOW-1064), stays on one line with short figures, so no loan amount is cut (FLOW-1082). */
export const BalanceByProject320: Story = {
  name: "Balance sheet · by project at 320",
  ...phone320,
  render: () => <Balance entry="/reports/balance?view=project" />,
  play: async ({ canvasElement }) => {
    await hintsWhole(canvasElement);
    await fits(canvasElement);
  },
};

/** FLOW-1082: at 393 each loan amount stays whole on the hint's own line. */
export const BalanceByProject393: Story = {
  name: "Balance sheet · by project at 393",
  ...phone393,
  render: () => <Balance entry="/reports/balance?view=project" />,
  play: async ({ canvasElement }) => {
    await hintsWhole(canvasElement);
    await fits(canvasElement);
  },
};

export const PropertyDrill: Story = {
  name: "Balance sheet · a property drilled",
  render: () => <Balance entry={`/reports/balance?view=project&project=${REPORTS_PROJECT_IDS.oak}`} sample={OAK_SHEET == null ? {} : { drilled: OAK_SHEET }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("heading", { level: 1, name: "Oak Ridge" })).toBeInTheDocument();
  },
};

export const BalanceLoading: Story = { name: "Balance sheet · loading", render: () => <Balance sample={{ phase: { kind: "loading" } }} /> };
export const BalanceEmpty: Story = { name: "Balance sheet · empty", render: () => <Balance sample={{ balance: { ...REPORTS_BALANCE, currencies: [] } }} /> };

// ---- The sheets ----------------------------------------------------------------------------------

export const PeriodSheet: Story = {
  name: "Sheet · period",
  render: () => <Pnl />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "השנה · 2026" }));
  },
};

function BrowserReports() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [router] = useState(() => createBrowserRouter([
    { path: "*", element: <PnlReportScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, byProject: REPORTS_BY_PROJECT }} /> },
  ]));
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}

/**
 * The browser's own history (not a memory router, which the screen tests use): closing the sheet steps back
 * over its entry, and the address still holds the pick afterwards.
 */
export const PeriodPickBrowserHistory: Story = {
  name: "Sheet · period pick in the browser's history",
  render: () => <BrowserReports />,
  play: async ({ canvasElement }) => {
    const before = `${window.location.pathname}${window.location.search}`;
    try {
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "השנה · 2026" }));
      const sheet = await within(document.body).findByRole("dialog", { name: "תקופה" });
      await userEvent.click(within(sheet).getByRole("radio", { name: /חודש שעבר/ }));
      await waitFor(async () => { await expect(within(document.body).queryByRole("dialog", { name: "תקופה" })).toBeNull(); });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await expect(new URLSearchParams(window.location.search).get("period")).toBe("last_month");
      await expect(canvas.getByRole("button", { name: /^חודש שעבר/ })).toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "", before);
    }
  },
};

/**
 * FLOW-162: the share sheet: PDF or Excel, which reports, and whether collapsed sections print in full.
 * FLOW-993: the columns (סה״כ, פרויקט, חודש, רבעון, שנה) and the projects.
 */
export const ShareSheet: Story = {
  name: "Sheet · share",
  render: () => <Pnl />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = await within(document.body).findByRole("dialog", { name: "שיתוף PDF" });
    await expect(within(sheet).getByRole("switch", { name: "רווח והפסד" })).toBeChecked();
    await expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeEnabled();
    await expect(within(sheet).getByRole("radio", { name: "סה״כ" })).toBeChecked();
  },
};

/** FLOW-993: some projects picked, by quarter, at 320: the five columns and the project switches fit the width. */
export const ShareSheetProjects320: Story = {
  name: "Sheet · share · projects by quarter at 320",
  ...phone320,
  render: () => <Pnl />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = await storyBody(canvasElement).findByRole("dialog", { name: "שיתוף PDF" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "רבעון" }));
    await userEvent.click(within(sheet).getByRole("switch", { name: "כל הפרויקטים" }));
    const group = within(sheet).getByRole("group", { name: "פרויקטים" });
    const [first] = within(group).getAllByRole("switch");
    if (first != null) await userEvent.click(first);
    await expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeEnabled();
    for (const segment of sheet.querySelectorAll<HTMLElement>(".ui-seg-label")) {
      await expect(segment.scrollWidth).toBeLessThanOrEqual(segment.clientWidth);
    }
  },
};

/** The four sample projects, the general expenses and four more, invented names. */
const EIGHT_PROJECTS = [
  ...REPORTS_BY_PROJECT.projects,
  ...["Birch Lane", "Elm Court", "Pine Hill", "Willow Row"].map((name, index) => {
    const id = `a0000000-0000-4000-8000-00000000017${String(index)}`;
    return { key: id, project_id: id, name, currencies: REPORTS_BY_PROJECT.projects[0]?.currencies ?? [] };
  }),
];

/**
 * FLOW-456: eight projects at 320. Turning off "כל הפרויקטים" starts with every project on, so the sheet can
 * still share; with none picked, the reason stands in the foot above the button, in view, not at the body's end.
 */
export const ShareSheetNoProject320: Story = {
  name: "Sheet · share · 8 projects, none picked at 320",
  ...phone320,
  render: () => <Pnl sample={{ byProject: { ...REPORTS_BY_PROJECT, projects: EIGHT_PROJECTS } }} />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = await storyBody(canvasElement).findByRole("dialog", { name: "שיתוף PDF" });
    await userEvent.click(within(sheet).getByRole("switch", { name: "כל הפרויקטים" }));
    const button = within(sheet).getByRole("button", { name: "שיתוף PDF" });
    await expect(button).toBeEnabled();
    const group = within(sheet).getByRole("group", { name: "פרויקטים" });
    for (const item of within(group).getAllByRole("switch")) await userEvent.click(item);
    await expect(button).toBeDisabled();
    const why = within(sheet).getByRole("status");
    await expect(why).toHaveTextContent("בחרו לפחות פרויקט אחד.");
    // In view: the foot stays pinned, so the reason sits right above the button inside the screen.
    const box = why.getBoundingClientRect();
    await expect(box.bottom).toBeLessThanOrEqual(button.getBoundingClientRect().top + 1);
    await expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
  },
};

/**
 * FLOW-170: the balance sheet's date sheet says every date counts from the start, one caption under
 * the dates and under the calendar for another date (the owner asked for "from the start"). At 320,
 * in light and dark.
 */
export const BalanceDateSheet320: Story = {
  name: "Sheet · balance date at 320",
  ...phone320,
  render: () => <Balance />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    await userEvent.click(within(canvasElement).getByRole("button", { name: "היום" }));
    const sheet = await storyBody(canvasElement).findByRole("dialog", { name: "נכון לתאריך" });
    const note = within(sheet).getByText("המאזן כולל את כל התנועות מההתחלה ועד התאריך שבוחרים");
    await expect(within(sheet).getByRole("radiogroup", { name: "נכון לתאריך" })).toHaveAttribute("aria-describedby", note.id);
    const box = note.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(320);
    await expect(note.scrollWidth).toBeLessThanOrEqual(note.clientWidth + 1);
    // The calendar for another date says it too, inside the screen.
    await userEvent.click(within(sheet).getByRole("button", { name: "תאריך אחר" }));
    const again = await within(sheet).findByText("המאזן כולל את כל התנועות מההתחלה ועד התאריך שבוחרים");
    await expect(again.getBoundingClientRect().right).toBeLessThanOrEqual(320);
    await expect(again.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  },
};

export const CustomDates: Story = {
  name: "Sheet · custom dates",
  render: () => <Pnl entry="/reports/pnl?period=custom&from=2026-10-05&to=2026-10-20" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "⁦05/10/2026–20/10/2026⁩" }));
  },
};

/** A row's hint parts that show on its one line, each with whether it is cut with "…". */
function shownParts(row: Element): { text: string; cut: boolean }[] {
  const parts = [...row.querySelectorAll(".ui-row-hint .ui-hint-part")];
  const line = parts[0]?.getBoundingClientRect().top ?? 0;
  return parts
    .filter((part) => Math.abs(part.getBoundingClientRect().top - line) < 1)
    .map((part) => {
      const text = part.querySelector(".ui-hint-text");
      return { text: part.textContent, cut: text instanceof HTMLElement && text.scrollWidth > text.clientWidth + 1 };
    });
}

export const CategoryLines: Story = {
  name: "Drill-down · a category",
  render: () => <CategoryLinesView />,
  play: async ({ canvasElement }) => {
    // A side's total is not a loss: the figure keeps the text colour, never the loss red.
    const figure = canvasElement.querySelector(".ui-rep-summary-figure .ui-num");
    await expect(figure?.classList.contains("ui-loss")).toBe(false);
  },
};

/** FLOW-168: at 320 a long project after the date is cut with "…", not dropped; the date stays whole. */
export const CategoryLinesLongProject: Story = {
  name: "Drill-down · a long project at 320",
  ...phone320,
  render: () => <CategoryLinesView />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    const row = within(canvasElement).getByRole("link", { name: /Northside Hardware.*11\/09/ });
    const parts = shownParts(row);
    await expect(parts.map((part) => part.text)).toEqual(["11/09", " · Riverside Commons Phase Two Townhomes"]);
    await expect(parts.map((part) => part.cut)).toEqual([false, true]);
  },
};

/** The owner's ask (2026-10-29): search a category's lines; the split hides and the matches stay by month. */
export const CategoryLinesSearch: Story = {
  name: "Drill-down · search",
  render: CategoryLines.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("searchbox", { name: "חיפוש בתנועות" }), "northside");
    await expect(canvas.getByText("2 תנועות מתאימות")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: /לפי פרויקט/ })).toBeNull();
  },
};

/** A search with no match says so and offers the app's search, for the same words in this category, all dates. */
export const CategoryLinesNoMatch: Story = {
  name: "Drill-down · search, no match",
  render: CategoryLines.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("searchbox", { name: "חיפוש בתנועות" }), "roof");
    await expect(await canvas.findByRole("link", { name: "לחיפוש בכל התנועות" })).toHaveAttribute("href", "/search?q=roof&category=c-repairs");
  },
};

const LONG_LATIN = "Quarterly service visit for the boiler room and the shared laundry on the ground floor, parts, labour, inspection 120";
const LONG_HEBREW = "ביקור שירות רבעוני בחדר הדודים ובחדר הכביסה המשותף בקומת הקרקע, כולל חלקים, עבודה, ניקוי המסננים ובדיקת המעלית בבניין";

/**
 * A line found only by its description shows the description as its title and the supplier in the hint
 * (FLOW-167). At 320 the matched word stays in view, at the end of a Latin description and of a Hebrew one,
 * and the title stops at three lines: a late match (117 characters in) shows from a few words before it,
 * after "…", with the whole description in the row's name.
 */
export const CategoryLinesByDescription: Story = {
  name: "Drill-down · search by description",
  ...phone320,
  render: () => (
    <CategoryLinesView
      rows={[
        ...CATEGORY_ROWS,
        line("0005", "2026-08-14", 300, "Maple Ave", "Bright Electric", "החלפת לוח החשמל הראשי בקומת הכניסה, יחידה 4"),
        line("0006", "2026-08-06", 500, "Oak Ridge", "Northside Hardware", LONG_LATIN),
        line("0007", "2026-08-03", 700, "Cedar St", "Bright Electric", LONG_HEBREW),
      ]}
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    const canvas = within(canvasElement);
    const field = canvas.getByRole("searchbox", { name: "חיפוש בתנועות" });
    for (const [word, description, shown, hint] of [
      // FLOW-170 N3: a description that fits its three lines with the word in them shows whole.
      ["unit", "Water heater replacement, unit 2", "Water heater replacement, unit 2", "18/10 · Quick Fix Plumbing"],
      // Longer Hebrew words leave "יחידה" on a fourth line, so it is cut two words before it.
      ["יחידה", "החלפת לוח החשמל הראשי בקומת הכניסה, יחידה 4", "…בקומת הכניסה, יחידה 4", "14/08 · Bright Electric"],
      ["inspection", LONG_LATIN, "…parts, labour, inspection 120", "06/08 · Northside Hardware"],
      ["המעלית", LONG_HEBREW, "…המסננים ובדיקת המעלית בבניין", "03/08 · Bright Electric"],
    ] as const) {
      await userEvent.clear(field);
      await userEvent.type(field, word);
      await waitFor(() => expect(canvasElement.querySelectorAll(".ui-lines-group .ui-row")).toHaveLength(1));
      const row = canvasElement.querySelector(".ui-lines-group .ui-row");
      const title = row?.querySelector(".ui-row-title");
      await expect(title?.querySelector("[aria-hidden='true']")?.textContent ?? title?.textContent).toBe(shown);
      await expect(row?.querySelector(".ui-row-hint")?.textContent).toBe(hint);
      // The row's name keeps the whole description.
      await expect(row?.textContent.includes(description)).toBe(true);
      await expect(title != null && inView(title, word)).toBe(true);
      await expect(title != null && titleLines(title) <= 3).toBe(true);
    }
  },
};
