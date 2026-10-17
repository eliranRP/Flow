import type { CashLine } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { cashMonthKey, cashMonthName } from "../cash";
import { monthPeriod } from "../period";
import { withPeriodSearch } from "../project-period";
import { cash, cashRow, investment, months, project, thisMonth } from "../dev/project-cash-sample";
import { israelToday } from "../ui/date-math";
import { exampleOnBand } from "../ui/screen-stories-support";
import { StoryRoute } from "../ui/story-route";
import { ProjectDetailScreen } from "./flow-screens";
import { ProjectCashLinesScreen, ProjectCashMonthScreen } from "./project-cash-screens";
import { sampleMonthLines } from "../dev/project-month-sample";

/** FLOW-419 (owner's option A "Like Home"): a project opens on its cash. Invented figures. */

const meta = {
  title: "Screens/Project cash",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

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
    await expect(canvas.getByRole("heading", { name: "השקעה והלוואות" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "חודשים קודמים" })).toBeInTheDocument();
  },
};

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
    await expect(canvas.getAllByText("$210,000").length).toBe(2);
  },
};

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

export const ProjectCashKept: Story = {
  name: "Project, a month's לא נספר ברווח",
  render: () => {
    const key = cashMonthKey(cash.months[0]?.month ?? "");
    const owner: CashLine = { ...line("4", "השקעת בעלים לדוגמה", "השקעת בעלים", 107_000n), supplier_name: null, side: "in" };
    // FLOW-442: a $1,500 loan payment's principal ($900) names its part, out of the whole payment.
    const principal: CashLine = { ...line("7", "מלווה לדוגמה", "תשלומי הלוואה", 90_000n), transaction_id: "loan-7", part: "principal", line_minor: 150_000n };
    // The month's net is above its profit by the owner's money, so this story keeps its own month.
    const keptMonth = cashRow(310_000n, 75_000n, 128_000n);
    keptMonth.not_in_profit_categories = [{ name: "השקעת בעלים", amount_minor: 107_000n }];
    return (
      <StoryRoute entry={`/projects/p-c/cash/${key}/kept/USD`} tabs>
        <ProjectCashLinesScreen sample={{ months: months([[keptMonth]]), lines: [principal, owner] }} at={{ projectId: "p-c", month: key, side: "kept", currency: "USD" }} />
      </StoryRoute>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "לא נספר ברווח" })).toBeInTheDocument();
    await expect(canvas.getAllByText("$1,070").length).toBeGreaterThan(0);
    await expect(canvas.getByText("קרן")).toBeInTheDocument();
    await expect(canvasElement.textContent.replace(/\u00a0/g, " ")).toContain("מתוך $1,500");
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
    await expect(within(list).getByRole("img", { name: "לא נספר ברווח" })).toBeInTheDocument();
  },
};
