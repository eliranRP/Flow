import type { Meta, StoryObj } from "@storybook/react";
import { expect, waitFor, within } from "@storybook/test";
import { COMPANY_PROFIT_PAST_SAMPLE, COMPANY_PROFIT_SAMPLE } from "../dev/company-profit-sample";
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

/** A closed month by project, its overhead project named כללי: one כללי row, and it opens the overhead project. */
export const ClosedMonthOverhead: Story = {
  name: "Closed month: overhead project named כללי",
  render: () => <ProfitRoute entry="/profit?month=2026-07" sample={COMPANY_PROFIT_PAST_SAMPLE} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("כללי")).toHaveLength(1);
    await expect(canvas.getByText("כללי").closest("a")?.getAttribute("href")).toMatch(/^\/projects\/p0\/profit\?from=profit/);
  },
};

/** By category (board frame ProfitByCategory): income then expenses, the first category open to its lines. */
export const ByCategory: Story = {
  name: "By category, one row open",
  render: () => <ProfitRoute entry="/profit?by=category" sample={{ ...COMPANY_PROFIT_SAMPLE, openFirst: true }} />,
};

/** FLOW-954: invented kept-out categories and their lines (a purchase, a loan received, principal and escrow). */
const KEPT_OUT_SAMPLE: CompanyProfitSample = (() => {
  const group = (key: string, name: string, amount: bigint, count: number, projects: number, loanPart: string | null, account: [string, string]) => ({
    currency: "USD", key, name, amount_minor: amount, count, projects, loan_part: loanPart, account_type: account[0], account_name: account[1],
  });
  const row = (id: string, supplier: string, project: string, categoryId: string, amount: bigint, date: string) => ({
    transaction_id: id, part: null, description: supplier, supplier_name: supplier, project_name: project, category_name: null,
    doc_date: date, currency: "USD", amount_minor: amount, shared: false, source: "mercury", category_id: categoryId,
  });
  const { income, expense } = COMPANY_PROFIT_SAMPLE.categories;
  return {
    ...COMPANY_PROFIT_SAMPLE,
    categories: {
      income: income == null ? null : { ...income, excluded_groups: [group("k-loan-in", "קבלת הלוואה", 20_650_000n, 1, 1, null, ["liability", "Loan principal"])] },
      expense: expense == null ? null : {
        ...expense,
        excluded_groups: [
          group("k-buy", "רכישת נכס", 8_034_700n, 1, 1, null, ["asset", "Property"]),
          group("k-principal", "קרן הלוואה", 430_700n, 2, 2, "principal", ["liability", "Loan principal"]),
          group("k-escrow", "אסקרו", 96_300n, 2, 2, "escrow", ["asset", "Escrow"]),
        ],
      },
    },
    lines: [
      ...COMPANY_PROFIT_SAMPLE.lines,
      { direction: "income", categoryKey: "", categoryName: "", keptOut: true, rows: [row("t-k1", "Example Lending", "בית הדקל", "k-loan-in", 20_650_000n, "2026-10-08")] },
      {
        direction: "expense", categoryKey: "", categoryName: "", keptOut: true, rows: [
          row("t-k2", "Example Title Co", "וילה הברושים", "k-buy", 8_034_700n, "2026-10-06"),
          row("t-k3", "Example Mortgage", "בית השקד", "k-principal", 395_700n, "2026-10-07"),
          row("t-k4", "Example Loan Servicing", "דירת הרימון", "k-principal", 35_000n, "2026-10-04"),
          row("t-k5", "Example Mortgage", "בית השקד", "k-escrow", 60_000n, "2026-10-07"),
          row("t-k6", "Example Loan Servicing", "דירת הרימון", "k-escrow", 36_300n, "2026-10-04"),
        ],
      },
    ],
  };
})();

/** FLOW-954 (board LedgerBreakdownKeptOut): after the counted groups, לא נספר ברווח, one row open to its lines. */
export const ByCategoryKeptOut: Story = {
  name: "By category, kept out of profit",
  render: () => <ProfitRoute entry="/profit?by=category" sample={KEPT_OUT_SAMPLE} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const kept = await canvas.findByRole("region", { name: "לא נספר ברווח" });
    await expect(within(kept).getByText("+$206,500")).toBeInTheDocument();
    within(kept).getByText("קרן הלוואה").closest("button")?.click();
    await waitFor(() => expect(within(kept).getByText("Example Loan Servicing")).toBeInTheDocument());
  },
};

/** FLOW-954: a loan received opened: its line reads "+" in the text colour, never the income green. */
export const ByCategoryKeptOutIncome: Story = {
  name: "By category, a loan received opened",
  render: () => <ProfitRoute entry="/profit?by=category" sample={KEPT_OUT_SAMPLE} />,
  play: async ({ canvasElement }) => {
    const kept = await within(canvasElement).findByRole("region", { name: "לא נספר ברווח" });
    within(kept).getByText("קבלת הלוואה").closest("button")?.click();
    const line = await waitFor(() => {
      const row = within(kept).getByText("Example Lending").closest("a");
      if (row == null) throw new Error("no line");
      return row;
    });
    const amount = line.querySelector(".ui-num");
    await expect(amount?.textContent).toMatch(/^\+\$206,500/);
    await expect(amount?.classList.contains("ui-income")).toBe(false);
    await expect(kept.querySelector(".ui-income")).toBeNull();
  },
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

/** The year by project: the finished projects in one row, the general costs last under the overhead project's name. */
export const YearByProject: Story = {
  name: "Period: this year by project",
  render: () => <ProfitRoute entry="/profit?period=year&list=project" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("פרויקטים שהסתיימו · 4")).toBeInTheDocument();
    await expect(canvas.getByText("משרד החברה / תקורה").closest("a")?.getAttribute("href")).toMatch(/^\/projects\/p0\/profit\?from=profit/);
  },
};

/** No overhead project set: the general costs are one כללי row that opens nothing; p0 is a project like any other. */
export const NoOverheadProject: Story = {
  name: "By project: no overhead project",
  render: () => <ProfitRoute entry="/profit" sample={{ ...COMPANY_PROFIT_SAMPLE, overhead: null }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("כללי").closest("a")).toBeNull();
    await expect(canvas.getByText("משרד החברה / תקורה").closest("a")).not.toBeNull();
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
