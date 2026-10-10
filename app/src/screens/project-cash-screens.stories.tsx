import type { CashLine, CashMonths, ProjectDetail } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { cashMonthKey } from "../cash";
import { shiftMonthKey } from "../period";
import { israelToday } from "../ui/date-math";
import { FILLED } from "../ui/investment-card.stories-support";
import { at320, dark, exampleOnBand } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ProjectDetailScreen } from "./flow-screens";
import { ProjectCashLinesScreen, ProjectCashMonthScreen } from "./project-cash-screens";

/** FLOW-417 (owner's option A "Like Home"): a project opens on its cash. Invented figures. */

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
  };
}

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
  [cashRow(310_000n, 500_000n, 95_000n)],
  [cashRow(310_000n, 195_000n, 101_000n)],
  [cashRow(310_000n, 212_000n, 98_000n)],
]);

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
  by_currency: [{ currency: "USD", income_minor: 310_000n, direct_minor: 182_000n, shared_minor: 0n, profit_minor: 128_000n }],
  categories: [],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [],
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
    <StoryRoute entry="/projects/p-c/profit" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={project} sampleInvestment={investment} section="profit" sectionTo={sectionTo} />
    </StoryRoute>
  ),
};
export const ProjectProfitPage320: Story = { ...ProjectProfitPage, name: "Project, profit page, 320", ...at320 };

const earlier = cashMonthKey(cash.months[1]?.month ?? "");

export const ProjectCashMonth: Story = {
  name: "Project, an earlier month",
  render: () => (
    <StoryRoute entry={`/projects/p-c/cash/${earlier}`} tabs>
      <ProjectCashMonthScreen sample={cash} monthKey={earlier} projectId="p-c" />
    </StoryRoute>
  ),
};
export const ProjectCashMonthDark: Story = { ...ProjectCashMonth, name: "Project, an earlier month, dark", ...dark };

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
