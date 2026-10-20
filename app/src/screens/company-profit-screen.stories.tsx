import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "@storybook/test";
import { COMPANY_PROFIT_SAMPLE } from "../dev/company-profit-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { CompanyProfitScreen, type CompanyProfitSample } from "./company-profit-screen";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page at a route: `entry` carries `?by=` and the sample's own flags. */
function ProfitRoute({ entry, sample = COMPANY_PROFIT_SAMPLE }: { entry: string; sample?: CompanyProfitSample }) {
  return (
    <StoryRoute entry={entry} tabs>
      <ExampleBar />
      <CompanyProfitScreen sample={sample} />
    </StoryRoute>
  );
}

export const ByProject: Story = { name: "By project", render: () => <ProfitRoute entry="/profit" /> };

/**
 * The head (canvas note spec-fcwide, items 0 and 2): the summary rows with dividers, November's card (no link:
 * "5 פרויקטים וכללי") and the company's six months with the forecast. The dark pass draws it in dark too.
 */
export const NextMonth: Story = {
  name: "Summary, next month and chart",
  render: () => <ProfitRoute entry="/profit" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("רווח מתחילת השנה")).toBeInTheDocument();
    await expect(canvas.getByText("5 פרויקטים וכללי")).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: /^צפי / })).toBeNull();
    await expect(canvas.getByRole("img", { name: /וצפי נובמבר/ })).toBeInTheDocument();
  },
};

/** Six-figure sums (+$131,600 / $122,754): both card figures step down together and stay whole at 320. */
const SIX_FIGURES: CompanyProfitSample = (() => {
  const next = COMPANY_PROFIT_SAMPLE.next;
  if (next == null) return COMPANY_PROFIT_SAMPLE;
  const add = (id: string, categoryId: string, direction: "income" | "expense") => ({
    id, project_id: "p1", kind: "add" as const, row_key: null, category_id: categoryId, category_name: null, direction, amount_minor: 10_000_000, pace: "once" as const, start_month: "2026-11",
  });
  return { ...COMPANY_PROFIT_SAMPLE, next: { ...next, inputs: { ...next.inputs, edits: [...next.inputs.edits, add("e-big-in", "c-other-income", "income"), add("e-big-out", "c-materials", "expense")] } } };
})();

export const NextMonthSixFigures: Story = {
  name: "Next month, six-figure sums",
  render: () => <ProfitRoute entry="/profit" sample={SIX_FIGURES} />,
  play: async ({ canvasElement }) => {
    const card = canvasElement.ownerDocument.querySelector(".ui-cp-head .ui-fc-card");
    await expect(card?.textContent).toContain("$131,600");
    await expect(card?.textContent).toContain("$122,754");
  },
};

/** An earlier month (Home's ?month=): its own figures only, no next month or chart. */
export const ClosedMonth: Story = {
  name: "Closed month",
  render: () => <ProfitRoute entry="/profit?month=2026-09" sample={{ ...COMPANY_PROFIT_SAMPLE, monthKey: "2026-09" }} />,
};

/** By category (board frame ProfitByCategory): income then expenses, the first category open to its lines. */
export const ByCategory: Story = {
  name: "By category, one row open",
  render: () => <ProfitRoute entry="/profit?by=category" sample={{ ...COMPANY_PROFIT_SAMPLE, openFirst: true }} />,
};

export const ByDate: Story = { name: "By date", render: () => <ProfitRoute entry="/profit?by=date" /> };

export const ByAmount: Story = { name: "By amount", render: () => <ProfitRoute entry="/profit?by=amount" /> };

/** The month is a loss: the figure and the loss rows read in the signal colour, with the minus. */
export const Loss: Story = { name: "Loss", render: () => <ProfitRoute entry="/profit" /> };

/** Scrolled: the compact bar shows the figure and the chips once the large title scrolls off. */
export const Scrolled: Story = {
  name: "Scrolled, compact bar",
  render: () => <ProfitRoute entry="/profit?by=date" />,
  play: async ({ canvasElement }) => {
    window.scrollTo(0, 400);
    const bar = await waitFor(() => canvasElement.ownerDocument.querySelector<HTMLElement>(".ui-compact-bar"));
    if (bar == null) throw new Error("the compact bar is not drawn");
    await expect(bar).toBeInTheDocument();
    window.scrollTo(0, 0);
  },
};

/**
 * FLOW-145, board Profit · 2026 (canvas note spec-years): the switch on 2026, the year to date, the "סוף 2026"
 * card in the תזרים צפוי form, January to October with November and December dashed, the months newest first.
 */
export const Year: Story = {
  name: "Period: this year",
  render: () => <ProfitRoute entry="/profit?period=year" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("radio", { name: "2026" })).toHaveAttribute("aria-checked", "true");
    await expect(canvas.getByText("רווח 2025 כולה")).toBeInTheDocument();
    await expect(canvas.getByText("סוף 2026")).toBeInTheDocument();
    await expect(canvas.getByRole("img", { name: /וצפי לנובמבר ודצמבר$/ })).toBeInTheDocument();
  },
};

/** The year by project: the finished projects in one row, כללי last. */
export const YearByProject: Story = {
  name: "Period: this year by project",
  render: () => <ProfitRoute entry="/profit?period=year&list=project" />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("פרויקטים שהסתיימו · 4")).toBeInTheDocument();
  },
};

/** A past year, opened from מההתחלה: "2025 · שנה סגורה", no card, twelve solid months, compared with 2024. */
export const PastYear: Story = {
  name: "Period: a past year",
  render: () => <ProfitRoute entry="/profit?period=year&year=2025" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("2025 · שנה סגורה")).toBeInTheDocument();
    await expect(canvas.getByText("רווח 2024 כולה")).toBeInTheDocument();
    await expect(canvasElement.ownerDocument.querySelector(".ui-cp-head .ui-fc-card")).toBeNull();
  },
};

/** Board Profit · מההתחלה: since January 2024, a pair per year (2026 capped with the rest of the year), a row per year. */
export const AllTime: Story = {
  name: "Period: since the start",
  render: () => <ProfitRoute entry="/profit?period=all" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("מאז ינואר 2024 · 3 שנים")).toBeInTheDocument();
    await expect(canvas.getByText("השנה הרווחית ביותר · 2025")).toBeInTheDocument();
    await expect(canvas.getByRole("region", { name: "לפי שנה" })).toBeInTheDocument();
  },
};

/** The basis sheet over the page: the two choices with their notes. */
export const BasisSheet: Story = {
  name: "Basis sheet",
  render: () => <ProfitRoute entry="/profit" sample={{ ...COMPANY_PROFIT_SAMPLE, sheetOpen: true }} />,
};
