import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
  REPORTS_BALANCE,
  REPORTS_BALANCE_SUSPENSE,
  REPORTS_BY_PROJECT,
  REPORTS_EMPTY,
  REPORTS_PROJECT_IDS,
  REPORTS_STATEMENT,
  REPORTS_TODAY,
} from "../dev/reports-sample";
import { ExampleBar, storyBody } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ToastProvider } from "../ui/toast";
import { HomeReportsCard } from "./home-reports-card";
import { CATEGORY_ROWS, CategoryLinesView, inView, line, titleLines } from "./report-lines-story-support";
import { ReportsScreen, type ReportsSample } from "./reports-screen";

/** FLOW-161: the reports screen, the category drill-down and the Home card (board row "דוחות"). */
const meta = {
  title: "Screens/Reports",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Reports({ entry = "/reports", sample = {} }: { entry?: string; sample?: Partial<ReportsSample> }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <ReportsScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE, projects: REPORTS_BY_PROJECT, ...sample }} />
    </StoryRoute>
  );
}

/** The P&L of every project this year: the net first, then income, expenses and the bottom line. */
export const ProfitAndLoss: Story = {
  name: "P&L · all projects",
  render: () => <Reports />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("30% מההכנסות · \u206601/01/2026–31/10/2026\u2069")).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /ריבית משכנתא/ })).toBeInTheDocument();
  },
};

/** כיווץ הכל: every section shut, each total still on its header. */
export const Collapsed: Story = {
  name: "P&L · collapsed",
  render: () => <Reports />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "כיווץ הכל" }));
    await expect(canvas.getByRole("button", { name: "פתיחת הכל" })).toBeInTheDocument();
  },
};

export const ByProject: Story = {
  name: "P&L · by project",
  render: () => <Reports entry="/reports?scope=by_project" sample={{ statement: REPORTS_BY_PROJECT }} />,
};

export const OneProject: Story = {
  name: "P&L · one project",
  render: () => <Reports entry={`/reports?scope=project&project=${REPORTS_PROJECT_IDS.cedar}`} sample={{ statement: { ...REPORTS_STATEMENT, project_id: REPORTS_PROJECT_IDS.cedar, project_name: "Cedar St" } }} />,
};

export const BalanceSheet: Story = {
  name: "Balance sheet · today",
  render: () => <Reports entry="/reports?kind=balance" />,
};

export const BalanceSuspense: Story = {
  name: "Balance sheet · Suspense",
  render: () => <Reports entry="/reports?kind=balance" sample={{ balance: REPORTS_BALANCE_SUSPENSE }} />,
};

export const PeriodSheet: Story = {
  name: "Sheet · period",
  render: () => <Reports />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "השנה · 2026" }));
  },
};

function BrowserReports() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [router] = useState(() => createBrowserRouter([
    { path: "*", element: <ReportsScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE, projects: REPORTS_BY_PROJECT }} /> },
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
  render: () => <Reports />,
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
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => <Reports />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = await storyBody(canvasElement).findByRole("dialog", { name: "שיתוף PDF" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "רבעון" }));
    await userEvent.click(within(sheet).getByRole("switch", { name: "כל הפרויקטים" }));
    const group = within(sheet).getByRole("group", { name: "פרויקטים" });
    const [first] = within(group).getAllByRole("switch");
    if (first != null) await userEvent.click(first);
    await expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeEnabled();
    const box = group.getBoundingClientRect();
    await expect(box.left).toBeGreaterThanOrEqual(0);
    await expect(box.right).toBeLessThanOrEqual(320);
  },
};

/**
 * FLOW-170: the balance sheet's date sheet says every date counts from the start, one caption under
 * the dates and under the calendar for another date (the owner asked for "from the start"). At 320,
 * in light and dark.
 */
export const BalanceDateSheet320: Story = {
  name: "Sheet · balance date at 320",
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => <Reports entry="/reports?kind=balance" />,
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
  render: () => <Reports entry="/reports?period=custom&from=2026-10-05&to=2026-10-20" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "\u206605/10/2026–20/10/2026\u2069" }));
  },
};

export const ProjectsSheet: Story = {
  name: "Sheet · projects",
  render: () => <Reports />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "כל הפרויקטים" }));
  },
};

export const Empty: Story = { name: "State · empty period", render: () => <Reports entry="/reports?period=last_month" sample={{ statement: REPORTS_EMPTY }} /> };
export const Loading: Story = { name: "State · loading", render: () => <Reports sample={{ phase: { kind: "loading" } }} /> };
export const Failed: Story = { name: "State · failed to load", render: () => <Reports sample={{ phase: { kind: "error", offline: false } }} /> };
export const Offline: Story = { name: "State · offline", render: () => <Reports sample={{ offlineSince: Date.parse("2026-10-31T07:41:00Z") }} /> };

const phone320 = { globals: { viewport: { value: "flow320", isRotated: false } } };

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

export const HomeCard: Story = {
  name: "Home · דוחות card",
  render: () => (
    <StoryRoute entry="/">
      <HomeReportsCard today={REPORTS_TODAY} search="" sample={{ statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE }} />
    </StoryRoute>
  ),
};

/** At 320 both figures step down together until the longer one fits its half ("$285,000" was 18px wider). */
export const HomeCardNarrow: Story = {
  name: "Home · דוחות card at 320",
  globals: { viewport: { value: "flow320", isRotated: false } },
  render: () => (
    <StoryRoute entry="/">
      <HomeReportsCard today={REPORTS_TODAY} search="" sample={{ statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE }} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    const halves = [...canvasElement.querySelectorAll<HTMLElement>(".ui-home-rep-half")];
    await expect(halves).toHaveLength(2);
    const measure = () => halves.map((half) => {
      const figure = half.querySelector<HTMLElement>(".ui-home-rep-figure .ui-num");
      if (figure == null) throw new Error("no figure");
      return { width: figure.getBoundingClientRect().width, room: half.clientWidth, size: getComputedStyle(figure).fontSize };
    });
    // Each figure ends inside its half once the step has settled.
    await waitFor(() => {
      if (measure().some((row) => row.width > row.room + 0.5)) throw new Error("a figure is wider than its half");
    });
    const [pnl, balance] = measure();
    // The two share one size.
    await expect(pnl?.size).toBe(balance?.size);
  },
};
