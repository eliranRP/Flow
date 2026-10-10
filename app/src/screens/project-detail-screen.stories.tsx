import type { ProjectDetail as ProjectDetailData } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, within } from "@storybook/test";
import { ProjectDetailScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { FILLED } from "../ui/investment-card.stories-support";
import { at320, dark, ExampleBar, exampleOnBand, storyBody } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProjectSharedCost: Story = {
  name: "Shared cost note",
  render: () => (
    <StoryRoute entry="/projects/a" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={{
          id: "a",
          name: "וילה רעננה",
          status: "active",
          state_label: "משפ׳ כהן · מתחילת הפרויקט",
          budget_agorot: 100_000_000n,
          income_agorot: 90_000_000n,
          direct_agorot: 72_000_000n,
          shared_agorot: 4_000_000n,
          profit_agorot: 14_000_000n,
          categories: [
            { id: "c1", name: "חומרים", amount_agorot: 72_000_000n, has_shared_share: false },
            { id: "c2", name: "הובלה", amount_agorot: 4_000_000n, has_shared_share: true },
          ],
          pending_count: 0,
          pending_agorot: 0n,
          transactions: [],
        }}
      />
    </StoryRoute>
  ),
};

export const ProjectDetail: Story = {
  render: () => (
    <StoryRoute entry="/projects/a" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={{
          id: "a",
          name: "וילה רעננה",
          status: "active",
          state_label: "משפ׳ כהן · מתחילת הפרויקט",
          budget_agorot: 100_000_000n,
          income_agorot: 90_000_000n,
          direct_agorot: 72_000_000n,
          shared_agorot: 0n,
          profit_agorot: 18_000_000n,
          categories: [
            { id: "c1", name: "חומרים", amount_agorot: 30_000_000n },
            { id: "c2", name: "קבלני משנה", amount_agorot: 22_000_000n },
            { id: "c3", name: "עבודה", amount_agorot: 12_000_000n },
          ],
          pending_count: 1,
          pending_agorot: 8_000_000n,
          transactions: [
            {
              id: "t1",
              description: "חומרי בניין לדוגמה",
              doc_date: "2026-09-14",
              amount_net: -8_500_000n,
              direction: "expense",
              category: "חומרים",
            },
          ],
        }}
      />
    </StoryRoute>
  ),
};

export const ProjectDetailLoading: Story = {
  render: () => (
    <StoryRoute entry="/projects/a?preview=loading" tabs>
      <ProjectDetailScreen example={exampleOnBand} />
    </StoryRoute>
  ),
};

export const ProjectDetailError: Story = {
  render: () => (
    <StoryRoute entry="/projects/a?preview=error" tabs>
      <ExampleBar />
      <ProjectDetailScreen />
    </StoryRoute>
  ),
};

export const ProjectUsdOnly: Story = {
  render: () => (
    <StoryRoute entry="/projects/usd1" tabs>
      <ExampleBar />
      <ProjectDetailScreen
        sample={{
          id: "usd1",
          name: "Cedar Lot",
          status: "active",
          state_label: "פעיל",
          budget_agorot: null,
          income_agorot: 0n,
          direct_agorot: 0n,
          shared_agorot: 0n,
          profit_agorot: 0n,
          by_currency: [{ currency: "USD", income_minor: 500_000n, direct_minor: 200_000n, shared_minor: 0n, profit_minor: 300_000n }],
          categories_by_currency: [{ currency: "USD", id: "u1", name: "Utilities", amount_minor: 200_000n }],
          categories: [],
          pending_count: 0,
          transactions: [],
        }}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

export const ProjectMixedCurrency: Story = {
  render: () => (
    <StoryRoute entry="/projects/mix1" tabs>
      <ExampleBar />
      <ProjectDetailScreen
        sample={{
          id: "mix1",
          name: "Harbor Sample",
          status: "active",
          state_label: "פעיל",
          budget_agorot: null,
          income_agorot: 100_000n,
          direct_agorot: 40_000n,
          shared_agorot: 0n,
          profit_agorot: 60_000n,
          by_currency: [
            { currency: "ILS", income_minor: 100_000n, direct_minor: 40_000n, shared_minor: 0n, profit_minor: 60_000n },
            { currency: "USD", income_minor: 200_000n, direct_minor: 50_000n, shared_minor: 0n, profit_minor: 150_000n },
          ],
          categories_by_currency: [
            { currency: "ILS", id: "i1", name: "Materials", amount_minor: 40_000n },
            { currency: "USD", id: "u1", name: "Freight", amount_minor: 50_000n },
          ],
          categories: [],
          pending_count: 0,
          transactions: [],
        }}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

// FLOW-339: a profit in shekels and a loss in dollars; the band's label names both.
export const ProjectMixedSigns: Story = {
  render: () => (
    <StoryRoute entry="/projects/mix2" tabs>
      <ExampleBar />
      <ProjectDetailScreen
        sample={{
          id: "mix2",
          name: "נמל לדוגמה",
          status: "active",
          state_label: "פעיל",
          budget_agorot: null,
          income_agorot: 100_000n,
          direct_agorot: 40_000n,
          shared_agorot: 0n,
          profit_agorot: 60_000n,
          by_currency: [
            { currency: "ILS", income_minor: 100_000n, direct_minor: 40_000n, shared_minor: 0n, profit_minor: 60_000n },
            { currency: "USD", income_minor: 50_000n, direct_minor: 175_000n, shared_minor: 0n, profit_minor: -125_000n },
          ],
          categories_by_currency: [
            { currency: "ILS", id: "i1", name: "חומרים", amount_minor: 40_000n },
            { currency: "USD", id: "u1", name: "הובלה", amount_minor: 175_000n },
          ],
          categories: [],
          pending_count: 0,
          transactions: [
            { id: "ms1", description: "תשלום לקוח לדוגמה", doc_date: "2026-10-04", amount_net: 100_000n, direction: "income", category: null },
            { id: "ms2", description: "ספק חומרים לדוגמה", doc_date: "2026-09-22", amount_net: -40_000n, direction: "expense", category: "חומרים" },
            { id: "ms3", description: "לקוח חו״ל לדוגמה", doc_date: "2026-09-12", amount_net: 50_000n, currency: "USD", direction: "income", category: null },
            { id: "ms4", description: "חברת הובלה לדוגמה", doc_date: "2026-08-28", amount_net: -175_000n, currency: "USD", direction: "expense", category: "הובלה" },
          ],
        }}
        example={exampleOnBand}
      />
    </StoryRoute>
  ),
};

export const ProjectMixedSignsDark: Story = { ...ProjectMixedSigns, globals: { theme: "dark" } };
export const ProjectMixedSigns320: Story = { ...ProjectMixedSigns, parameters: { viewport: { defaultViewport: "flow320" } } };

const periodProject: NonNullable<ProjectDetailData> = {
  id: "p-a",
  name: "וילה לדוגמה",
  status: "active",
  state_label: "פעיל",
  budget_agorot: 100_000_000n,
  income_agorot: 36_600_000n,
  direct_agorot: 26_420_000n,
  shared_agorot: 0n,
  profit_agorot: 10_180_000n,
  categories: [
    { id: "c1", name: "קבלני משנה", amount_agorot: 11_800_000n },
    { id: "c2", name: "חומרים", amount_agorot: 8_240_000n },
    { id: "c3", name: "עבודה", amount_agorot: 4_120_000n },
  ],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [
    { id: "pt1", description: "חשמלאי לדוגמה", doc_date: "2026-10-05", amount_net: -632_000n, direction: "expense", category: "עבודה" },
    { id: "pt2", description: "החזר ציוד לדוגמה", doc_date: "2026-10-02", amount_net: -150_000n, direction: "expense", category: "ציוד", kept_out: true },
    { id: "pt3", description: "חומרי בניין לדוגמה", doc_date: "2026-09-18", amount_net: -1_200_000n, direction: "expense", category: "חומרים", parts_minor: 800_000n },
    { id: "pt4", description: "תשלום לקוח לדוגמה", doc_date: "2026-08-20", amount_net: 18_600_000n, direction: "income", category: null },
  ],
};

export const ProjectPeriod: Story = {
  name: "Project, profit page, own period",
  render: () => (
    <StoryRoute entry="/projects/p-a/profit" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={periodProject} section="profit" />
    </StoryRoute>
  ),
};
export const ProjectPeriodDark: Story = { ...ProjectPeriod, name: "Project, own period, dark", ...dark };
export const ProjectPeriod320: Story = { ...ProjectPeriod, name: "Project, own period, 320", ...at320 };
export const ProjectPeriodDark320: Story = { ...ProjectPeriod, name: "Project, own period, dark, 320", ...dark, ...at320 };
/** A month from the "לפי חודש" list. The row still shows: the page lists the whole project (FLOW-337). */
export const ProjectOneMonth: Story = {
  name: "Project, one month opened from by month",
  render: () => (
    <StoryRoute entry="/projects/p-a/profit?period=month&at=2026-09" tabs>
      <ProjectDetailScreen example={exampleOnBand} section="profit" sample={{ ...periodProject, transactions: periodProject.transactions.filter((txn) => txn.doc_date.startsWith("2026-09")) }} />
    </StoryRoute>
  ),
};
/** הכול on a project reads מתחילת הפרויקט (FLOW-411), and the budget shows. */
export const ProjectFromStart: Story = {
  name: "Project, from the start",
  render: () => (
    <StoryRoute entry="/projects/p-a/profit?period=all" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={periodProject} section="profit" />
    </StoryRoute>
  ),
};

/** FLOW-404. The השקעה card under the categories, with invented figures. */
export const ProjectInvestment: Story = {
  name: "Project with investment card",
  render: () => (
    <StoryRoute entry="/projects/a" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sampleInvestment={{ isOverhead: false, figures: FILLED, categories: [], loans: [] }}
        sample={{
          id: "a",
          name: "וילה רעננה",
          status: "active",
          state_label: "פעיל",
          budget_agorot: null,
          income_agorot: 40_000_000n,
          direct_agorot: 26_130_000n,
          shared_agorot: 0n,
          profit_agorot: 13_870_000n,
          categories: [
            { id: "c1", name: "חומרים", amount_agorot: 14_280_000n },
            { id: "c2", name: "קבלן משנה", amount_agorot: 11_850_000n },
          ],
          pending_count: 0,
          pending_agorot: 0n,
          transactions: [],
        }}
      />
    </StoryRoute>
  ),
};

/** FLOW-340 C. The short project page: profit on the band, then one row per section. */
const overviewProject: NonNullable<ProjectDetailData> = {
  ...periodProject,
  loans: [
    // The open balances add up to the investment card's יתרת הלוואות (FILLED, ₪800,000).
    { id: "l1", name: "הלוואת גישור לדוגמה", currency: "ILS", balance_minor: 50_000_000n, status: "open" },
    { id: "l2", name: "משכנתא לדוגמה", currency: "ILS", balance_minor: 30_000_000n, status: "open" },
  ],
};
const sectionTo = (target: string) => (target === "overview" ? "/projects/p-a" : `/projects/p-a/${target}`);
const filledInvestment = { isOverhead: false, figures: FILLED, categories: [], loans: [] };

export const ProjectOverview: Story = {
  name: "Project, short page (FLOW-340 C)",
  render: () => (
    <StoryRoute entry="/projects/p-a" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={overviewProject} sampleInvestment={filledInvestment} sectionTo={sectionTo} />
    </StoryRoute>
  ),
};
export const ProjectOverviewDark: Story = { ...ProjectOverview, name: "Project, short page, dark", ...dark };
export const ProjectOverview320: Story = { ...ProjectOverview, name: "Project, short page, 320", ...at320 };
export const ProjectOverviewDark320: Story = { ...ProjectOverview, name: "Project, short page, dark, 320", ...dark, ...at320 };

/** FLOW-334: the ⋯ menu, the overhead switch then "סיום הפרויקט" as a row. */
export const ProjectMenu: Story = {
  name: "Project, ⋯ menu",
  render: ProjectOverview.render,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "עוד" }));
    await storyBody(canvasElement).findByRole("dialog", { name: "עוד" });
  },
};
export const ProjectMenuDark: Story = { ...ProjectMenu, name: "Project, ⋯ menu, dark", ...dark };
export const ProjectMenu320: Story = { ...ProjectMenu, name: "Project, ⋯ menu, 320", ...at320 };

/** FLOW-360 A: the ⋯ menu's קבוצה row, then its picker and the new group sheet. */
const sampleGroups = {
  groups: [{ id: "g1", name: "בניין לדוגמה" }, { id: "g2", name: "מתחם לדוגמה" }],
  currentId: null,
};
const groupedRender = (currentId: string | null) => () => (
  <StoryRoute entry="/projects/p-a" tabs>
    <ProjectDetailScreen
      example={exampleOnBand}
      sample={overviewProject}
      sampleInvestment={filledInvestment}
      sectionTo={sectionTo}
      sampleGroups={{ ...sampleGroups, currentId }}
    />
  </StoryRoute>
);
export const ProjectMenuGroup: Story = {
  name: "Project, ⋯ menu with קבוצה",
  render: groupedRender(null),
  play: ProjectMenu.play,
};
export const ProjectMenuGroupDark: Story = { ...ProjectMenuGroup, name: "Project, ⋯ menu with קבוצה, dark", ...dark };
export const ProjectMenuGroup320: Story = { ...ProjectMenuGroup, name: "Project, ⋯ menu with קבוצה, 320", ...at320 };

export const ProjectGroupPicker: Story = {
  name: "Project, group picker",
  render: groupedRender("g1"),
  play: async (context) => {
    await ProjectMenu.play?.(context);
    await userEvent.click(await storyBody(context.canvasElement).findByRole("button", { name: /קבוצה/ }));
    await storyBody(context.canvasElement).findByRole("radiogroup", { name: "קבוצה" });
  },
};
export const ProjectGroupPickerDark: Story = { ...ProjectGroupPicker, name: "Project, group picker, dark", ...dark };
export const ProjectGroupPicker320: Story = { ...ProjectGroupPicker, name: "Project, group picker, 320", ...at320 };

export const ProjectGroupNew: Story = {
  name: "Project, new group",
  render: groupedRender(null),
  play: async (context) => {
    await ProjectGroupPicker.play?.(context);
    await userEvent.click(storyBody(context.canvasElement).getByRole("button", { name: "קבוצה חדשה" }));
    await userEvent.type(await storyBody(context.canvasElement).findByLabelText("שם הקבוצה"), "מתחם הגפן");
  },
};
export const ProjectGroupNewDark: Story = { ...ProjectGroupNew, name: "Project, new group, dark", ...dark };

/** A pick saves at once; the toast says where the project went and offers ביטול. */
export const ProjectGroupMoved: Story = {
  name: "Project, moved to a group",
  render: groupedRender(null),
  play: async (context) => {
    await ProjectGroupPicker.play?.(context);
    await userEvent.click(storyBody(context.canvasElement).getByRole("radio", { name: "בניין לדוגמה" }));
    await storyBody(context.canvasElement).findByText("הפרויקט עבר לקבוצה בניין לדוגמה");
  },
};
export const ProjectGroupRemoved: Story = {
  name: "Project, taken out of its group",
  render: groupedRender("g1"),
  play: async (context) => {
    await ProjectGroupPicker.play?.(context);
    await userEvent.click(storyBody(context.canvasElement).getByRole("radio", { name: "בלי קבוצה" }));
    await storyBody(context.canvasElement).findByText("הפרויקט הוצא מהקבוצה בניין לדוגמה");
  },
};
export const ProjectGroupRemovedDark: Story = { ...ProjectGroupRemoved, name: "Project, taken out of its group, dark", ...dark };

/** A finished project offers "החזרה לפעיל" in the same place. */
export const ProjectMenuFinished: Story = {
  name: "Project, ⋯ menu, finished",
  render: () => (
    <StoryRoute entry="/projects/p-a" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={{ ...overviewProject, status: "finished", state_label: "הסתיים" }}
        sampleInvestment={filledInvestment}
        sectionTo={sectionTo}
      />
    </StoryRoute>
  ),
  play: ProjectMenu.play,
};

/** The neutral confirm: the button repeats the action, with no red and no bin. */
export const ProjectFinishConfirm: Story = {
  name: "Project, finish confirm",
  render: ProjectOverview.render,
  play: async (context) => {
    await ProjectMenu.play?.(context);
    const body = storyBody(context.canvasElement);
    await userEvent.click(await body.findByRole("button", { name: "סיום הפרויקט" }));
    await body.findByRole("dialog", { name: "לסיים את הפרויקט?" });
  },
};
export const ProjectFinishConfirmDark: Story = { ...ProjectFinishConfirm, name: "Project, finish confirm, dark", ...dark };
export const ProjectFinishConfirm320: Story = { ...ProjectFinishConfirm, name: "Project, finish confirm, 320", ...at320 };

export const ProjectExpenses: Story = {
  name: "Project, expenses section",
  render: () => (
    <StoryRoute entry="/projects/p-a/expenses" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={overviewProject} section="expenses" sectionTo={sectionTo} />
    </StoryRoute>
  ),
};
export const ProjectExpensesDark: Story = { ...ProjectExpenses, name: "Project, expenses section, dark", ...dark };
export const ProjectExpenses320: Story = { ...ProjectExpenses, name: "Project, expenses section, 320", ...at320 };

/** FLOW-334: the waiting row reads as Home's review row (inbox icon, tint), not a category. */
export const ProjectExpensesWaiting: Story = {
  name: "Project, expenses section, waiting row",
  render: () => (
    <StoryRoute entry="/projects/p-a/expenses" tabs>
      <ProjectDetailScreen
        example={exampleOnBand}
        sample={{ ...overviewProject, pending_count: 2, pending_agorot: 1_250_000n }}
        section="expenses"
        sectionTo={sectionTo}
      />
    </StoryRoute>
  ),
};
export const ProjectExpensesWaitingDark: Story = { ...ProjectExpensesWaiting, name: "Project, expenses section, waiting row, dark", ...dark };
export const ProjectExpensesWaiting320: Story = { ...ProjectExpensesWaiting, name: "Project, expenses section, waiting row, 320", ...at320 };

export const ProjectTransactionsSection: Story = {
  name: "Project, transactions section",
  render: () => (
    <StoryRoute entry="/projects/p-a/transactions" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={overviewProject} section="transactions" sectionTo={sectionTo} />
    </StoryRoute>
  ),
};
export const ProjectTransactionsSectionDark: Story = { ...ProjectTransactionsSection, name: "Project, transactions section, dark", ...dark };
export const ProjectTransactionsSection320: Story = { ...ProjectTransactionsSection, name: "Project, transactions section, 320", ...at320 };

// FLOW-424 (C18-1): a kept-out line with a long category keeps its amount and chevron in line with
// the counted rows at 320; the category drops whole instead of pushing them out.
const longKeptOut: NonNullable<ProjectDetailData> = {
  ...overviewProject,
  transactions: overviewProject.transactions.map((txn) => (txn.kept_out === true ? { ...txn, category: "קבלני משנה וחומרי גמר" } : txn)),
};
export const ProjectTransactionsLongKeptOut320: Story = {
  name: "Project, transactions section, long kept-out hint, 320",
  ...at320,
  render: () => (
    <StoryRoute entry="/projects/p-a/transactions" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={longKeptOut} section="transactions" sectionTo={sectionTo} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const rows = [...canvasElement.querySelectorAll<HTMLElement>("a.ui-row")].filter((row) => row.querySelector(".ui-row-chevron"));
    const kept = rows.find((row) => row.classList.contains("ui-row-set-aside"));
    const counted = rows.find((row) => !row.classList.contains("ui-row-set-aside"));
    const edge = (row: HTMLElement | undefined) => Math.round(row?.querySelector(".ui-row-chevron")?.getBoundingClientRect().left ?? -1);
    await expect(kept).toBeDefined();
    await expect(edge(kept)).toBe(edge(counted));
  },
};

export const ProjectLoansSection: Story = {
  name: "Project, loans section",
  render: () => (
    <StoryRoute entry="/projects/p-a/loans" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={overviewProject} section="loans" sectionTo={sectionTo} />
    </StoryRoute>
  ),
};
export const ProjectLoansSection320: Story = { ...ProjectLoansSection, name: "Project, loans section, 320", ...at320 };

export const ProjectInvestmentScreen: Story = {
  name: "Project, investment and loans section",
  render: () => (
    <StoryRoute entry="/projects/p-a/investment" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={overviewProject} sampleInvestment={filledInvestment} section="investment" sectionTo={sectionTo} />
    </StoryRoute>
  ),
};
export const ProjectInvestmentScreen320: Story = { ...ProjectInvestmentScreen, name: "Project, investment and loans section, 320", ...at320 };
