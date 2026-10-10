import type { CashLine, CashMonths, ProjectDetail } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { cashMonthKey, cashMonthName } from "../cash";
import { monthPeriod, shiftMonthKey } from "../period";
import { withPeriodSearch } from "../project-period";
import { israelToday } from "../ui/date-math";
import { FILLED } from "../ui/investment-card.stories-support";
import { at320, dark, exampleOnBand } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ProjectDetailScreen } from "./flow-screens";
import { ProjectCashLinesScreen, ProjectCashMonthScreen } from "./project-cash-screens";
import { SAMPLE_MONTH_FIGURES, SAMPLE_MONTH_KEPT, SAMPLE_PROFIT_FIGURES, sampleMonthLines, sampleProfitLines } from "../dev/project-month-sample";

/** FLOW-419 (owner's option A "Like Home"): a project opens on its cash. Invented figures. */

const meta = {
  title: "Screens/Project cash",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function cashRow(inMinor: bigint, outMinor: bigint, profit: bigint, currency = "USD") {
  return {
    currency,
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
    not_in_profit_categories: [] as { name: string; amount_minor: bigint }[],
  };
}

const thisMonth = israelToday().slice(0, 7);

function months(rows: ReturnType<typeof cashRow>[][], base = "USD"): NonNullable<CashMonths> {
  const current = israelToday().slice(0, 7);
  return {
    basis: "paid",
    base_currency: base,
    months: rows.map((byCurrency, back) => ({ month: `${shiftMonthKey(current, -back)}-01`, by_currency: byCurrency })),
  };
}

const cash = months([
  [cashRow(310_000n, 75_000n, 128_000n)],
  // FLOW-438: the earlier month's figures are the ones its listed lines add up to.
  [{ ...cashRow(SAMPLE_MONTH_FIGURES.in_minor, SAMPLE_MONTH_FIGURES.out_minor, SAMPLE_MONTH_FIGURES.profit_minor), not_in_profit_categories: SAMPLE_MONTH_KEPT }],
  [cashRow(310_000n, 195_000n, 101_000n)],
  [cashRow(310_000n, 212_000n, 98_000n)],
]);
// This month's net less its profit (לא נספר ברווח, FLOW-418): the owner's money put into the project.
const currentRow = cash.months[0]?.by_currency[0];
if (currentRow) currentRow.not_in_profit_categories = [{ name: "השקעת בעלים", amount_minor: 107_000n }];

const project: NonNullable<ProjectDetail> = {
  id: "p-c",
  name: "Cedar Ave 410",
  status: "active",
  state_label: "פעיל",
  budget_agorot: null,
  base_currency: "USD",
  income_agorot: 0n,
  direct_agorot: 0n,
  shared_agorot: 0n,
  profit_agorot: 0n,
  by_currency: [{ currency: "USD", ...SAMPLE_PROFIT_FIGURES, shared_minor: 0n }],
  categories: [],
  pending_count: 0,
  pending_agorot: 0n,
  // FLOW-438: the profit page lists these under its figures; they add up to them.
  transactions: sampleProfitLines(thisMonth),
  loans: [{ id: "l1", name: "הלוואת DSCR לדוגמה", currency: "USD", balance_minor: 21_360_000n, status: "open" }],
};

/** A dollar project's investment, so the row's figure is in the project's currency. */
const usdFigures = {
  ...FILLED,
  currency: "USD",
  purchaseMinor: 28_500_000n,
  arvMinor: 41_000_000n,
  valueMinor: 37_000_000n,
  rehabMinor: 6_200_000n,
  loanMinor: 21_360_000n,
  forcedEquityMinor: 6_300_000n,
  currentEquityMinor: 15_640_000n,
};
const investment = { isOverhead: false, figures: usdFigures, categories: [], loans: [] };
const sectionTo = (target: string) => (target === "overview" ? "/projects/p-c" : `/projects/p-c/${target}`);

export const ProjectCash: Story = {
  name: "Project, cash first",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleCash={cash} sampleInvestment={investment} sectionTo={sectionTo} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("link", { name: /^נכנס ב/ })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /^רווח ב/ })).toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /השקעה והלוואות/ })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "חודשים קודמים" })).toBeInTheDocument();
  },
};
export const ProjectCashDark: Story = { ...ProjectCash, name: "Project, cash first, dark", ...dark };
export const ProjectCash320: Story = { ...ProjectCash, name: "Project, cash first, 320", ...at320 };
export const ProjectCashDark320: Story = { ...ProjectCash, name: "Project, cash first, dark, 320", ...dark, ...at320 };

export const ProjectCashLoss: Story = {
  name: "Project, cash first, more out than in this month",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={project}
        sampleCash={months([[cashRow(0n, 2_066_316n, -60_000n)], [cashRow(310_000n, 75_000n, 128_000n)]])}
        sampleInvestment={investment}
        sectionTo={sectionTo}
      />
    </StoryRoute>
  ),
};

/** No investment data and no loan: the row hides, and the ⋯ menu keeps the way in. */
export const ProjectCashNoInvestment: Story = {
  name: "Project, cash first, no investment or loan",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={{ ...project, loans: [] }} sampleCash={cash} sectionTo={sectionTo} />
    </StoryRoute>
  ),
};

export const ProjectCashTwoCurrencies: Story = {
  name: "Project, cash first, two currencies",
  render: () => (
    <StoryRoute entry="/projects/p-c" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={project}
        sampleCash={months([
          [cashRow(310_000n, 75_000n, 128_000n), cashRow(1_200_000n, 450_000n, 750_000n, "ILS")],
          [cashRow(310_000n, 500_000n, 95_000n)],
        ])}
        sampleInvestment={investment}
        sectionTo={sectionTo}
      />
    </StoryRoute>
  ),
};
export const ProjectCashTwoCurrencies320: Story = { ...ProjectCashTwoCurrencies, name: "Project, cash first, two currencies, 320", ...at320 };

export const ProjectProfitPage: Story = {
  name: "Project, profit page",
  render: () => (
    // As the רווח החודש row opens it: on that row's month.
    <StoryRoute entry={`/projects/p-c/profit${withPeriodSearch("", monthPeriod(thisMonth))}`} tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleInvestment={investment} section="profit" sectionTo={sectionTo} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The page is the row's month, and its figure is the row's (cash's profit_minor, $1,280).
    await expect(canvas.getAllByText(new RegExp(cashMonthName(thisMonth))).length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("$1,280").length).toBeGreaterThan(0);
    // FLOW-438: the title names the month with the cash page's pager (this month: earlier only).
    await expect(canvas.getByRole("heading", { level: 1 })).toHaveTextContent(`רווח ${cashMonthName(thisMonth)}`);
    await expect(canvas.getAllByRole("button", { name: /^רווח / })).toHaveLength(1);
    // The list holds the counted lines only, and they make up הכנסות $3,100 and הוצאות $1,820.
    const list = canvas.getByRole("region", { name: "תנועות" });
    await expect(within(list).getAllByRole("link")).toHaveLength(3);
    await expect(canvas.queryByRole("link", { name: /^תנועות/ })).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: /^הוצאות .*\$1,820/ })).toBeInTheDocument();
  },
};

/** The same project's השקעה והלוואות page: the loan row's balance is the card's יתרת הלוואות. */
export const ProjectInvestmentLoans: Story = {
  name: "Project, investment and loans",
  render: () => (
    <StoryRoute entry="/projects/p-c/investment" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleInvestment={investment} section="investment" sectionTo={sectionTo} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("$213,600").length).toBe(2);
  },
};
export const ProjectProfitPage320: Story = { ...ProjectProfitPage, name: "Project, profit page, 320", ...at320 };

const earlier = cashMonthKey(cash.months[1]?.month ?? "");

export const ProjectCashMonth: Story = {
  name: "Project, an earlier month",
  render: () => (
    <StoryRoute entry={`/projects/p-c/cash/${earlier}`} tabs>
      <ProjectCashMonthScreen sample={cash} monthKey={earlier} projectId="p-c" projectName={project.name} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    // FLOW-422: Home's ‹ › pager by the title, both ways from a middle month; Back names the project.
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: new RegExp(project.name) })).toBeVisible();
    await expect(canvas.getAllByRole("button", { name: /^תזרים / })).toHaveLength(2);
  },
};
export const ProjectCashMonthDark: Story = { ...ProjectCashMonth, name: "Project, an earlier month, dark", ...dark };
export const ProjectCashMonth320: Story = { ...ProjectCashMonth, name: "Project, an earlier month, 320", ...at320 };

const oldest = cashMonthKey(cash.months.at(-1)?.month ?? "");

/** The oldest month the project's read holds keeps the earlier step's empty slot. */
export const ProjectCashMonthOldest: Story = {
  name: "Project, the oldest month it reads",
  render: () => (
    <StoryRoute entry={`/projects/p-c/cash/${oldest}`} tabs>
      <ProjectCashMonthScreen sample={cash} monthKey={oldest} projectId="p-c" projectName={project.name} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("button", { name: /^תזרים / })).toHaveLength(1);
  },
};

function line(id: string, supplier: string, category: string, minor: bigint): CashLine {
  const day = `${israelToday().slice(0, 7)}-0${id}`;
  return {
    transaction_id: id,
    part: null,
    description: supplier,
    supplier_name: supplier,
    project_name: null,
    category_name: category,
    doc_date: day,
    cash_month_date: day,
    currency: "USD",
    amount_minor: minor,
    side: "out",
    source: "mercury",
  };
}

export const ProjectCashLines: Story = {
  name: "Project, a month's יצא",
  render: () => {
    const key = cashMonthKey(cash.months[0]?.month ?? "");
    return (
      <StoryRoute entry={`/projects/p-c/cash/${key}/out/USD`} tabs>
        <ProjectCashLinesScreen
          sample={{ months: cash, lines: [line("6", "מלווה לדוגמה", "תשלומי הלוואה", 60_000n), line("2", "חנות חומרים לדוגמה", "שיפוץ", 15_000n)] }}
          at={{ projectId: "p-c", month: key, side: "out", currency: "USD" }}
        />
      </StoryRoute>
    );
  },
};
export const ProjectCashLines320: Story = { ...ProjectCashLines, name: "Project, a month's יצא, 320", ...at320 };

export const ProjectCashKept: Story = {
  name: "Project, a month's לא נספר ברווח",
  render: () => {
    const key = cashMonthKey(cash.months[0]?.month ?? "");
    const owner: CashLine = { ...line("4", "השקעת בעלים לדוגמה", "השקעת בעלים", 107_000n), supplier_name: null, side: "in" };
    return (
      <StoryRoute entry={`/projects/p-c/cash/${key}/kept/USD`} tabs>
        <ProjectCashLinesScreen sample={{ months: cash, lines: [owner] }} at={{ projectId: "p-c", month: key, side: "kept", currency: "USD" }} />
      </StoryRoute>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "לא נספר ברווח" })).toBeInTheDocument();
    await expect(canvas.getAllByText("$1,070").length).toBeGreaterThan(0);
  },
};

/** FLOW-438 (owner, 2026-10-10): the month's תנועות under its figures, a kept-out line in place. */
const monthLines = sampleMonthLines(earlier);

export const ProjectCashMonthWithLines: Story = {
  name: "Project, a month with its lines",
  render: () => (
    <StoryRoute entry={`/projects/p-c/cash/${earlier}`} tabs>
      <ProjectCashMonthScreen sample={cash} monthKey={earlier} projectId="p-c" projectName={project.name} sampleLines={monthLines} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = canvas.getByRole("region", { name: "תנועות" });
    await expect(within(list).getAllByRole("link")).toHaveLength(4);
    await expect(within(list).getByText("לא נספר ברווח")).toBeInTheDocument();
  },
};
export const ProjectCashMonthWithLinesDark: Story = { ...ProjectCashMonthWithLines, name: "Project, a month with its lines, dark", ...dark };
export const ProjectCashMonthWithLines320: Story = { ...ProjectCashMonthWithLines, name: "Project, a month with its lines, 320", ...at320 };
