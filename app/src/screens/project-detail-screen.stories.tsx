import type { ProjectDetail as ProjectDetailData } from "@flow/shared";
import type { Meta, StoryObj } from "@storybook/react";
import { ProjectDetailScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { FILLED } from "../ui/investment-card.stories-support";
import { at320, dark, ExampleBar, exampleOnBand, periodMonths } from "../ui/screen-stories-support";

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
              description: "חומרי בניין השרון",
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
  name: "Project, own period, summary first",
  render: () => (
    <StoryRoute entry="/projects/p-a" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={periodProject} sampleMonths={periodMonths} />
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
    <StoryRoute entry="/projects/p-a?period=month&at=2026-09" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={{ ...periodProject, transactions: periodProject.transactions.filter((txn) => txn.doc_date.startsWith("2026-09")) }} />
    </StoryRoute>
  ),
};
/** הכול on a project reads מתחילת הפרויקט (FLOW-411), and the budget shows. */
export const ProjectFromStart: Story = {
  name: "Project, from the start",
  render: () => (
    <StoryRoute entry="/projects/p-a?period=all" tabs>
      <ProjectDetailScreen example={exampleOnBand} sample={periodProject} sampleMonths={periodMonths} />
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
