import type { Meta, StoryObj } from "@storybook/react";
import { StoryRoute } from "../ui/story-route";
import { FILLED, MISSING } from "../ui/investment-card.stories-support";
import { ProjectInvestmentSection, type ProjectInvestment, type RehabCategory } from "./project-investment";

/** FLOW-404. Invented categories, loans and figures. */
const COSTS: ProjectInvestment["categories"] = [
  { id: "c-mat", name: "חומרים", currency: "ILS", minor: 14_280_000n },
  { id: "c-sub", name: "קבלן משנה", currency: "ILS", minor: 11_850_000n },
  { id: "c-arch", name: "אדריכל", currency: "ILS", minor: 3_200_000n },
  { id: null, name: null, currency: "ILS", minor: 1_910_000n },
  { id: "c-buy", name: "רכישת נכס", currency: "ILS", minor: 125_000_000n },
  { id: "c-int", name: "ריבית משכנתא", currency: "ILS", minor: 2_160_000n },
];

const CATEGORIES: RehabCategory[] = [
  { id: "c-mat", name: "חומרים", in_rehab: true, rehab: null },
  { id: "c-sub", name: "קבלן משנה", in_rehab: true, rehab: null },
  { id: "c-arch", name: "אדריכל", in_rehab: true, rehab: null },
  { id: "c-buy", name: "רכישת נכס", in_rehab: false, rehab: null, excluded_from_pnl: true },
  { id: "c-int", name: "ריבית משכנתא", in_rehab: false, rehab: null, loan_part: "interest" },
];

const FILLED_PROJECT: ProjectInvestment = {
  isOverhead: false,
  figures: FILLED,
  categories: COSTS,
  loans: [{ id: "l1", name: "משכנתא בנק לדוגמה", currency: "ILS", balance_minor: 80_000_000n }],
};

const MISSING_PROJECT: ProjectInvestment = {
  isOverhead: false,
  figures: MISSING,
  categories: [],
  loans: [
    { id: "l1", name: "הלוואה בשקלים לדוגמה", currency: "ILS", balance_minor: 110_000_000n },
    { id: "l2", name: "הלוואה בדולר לדוגמה", currency: "USD", balance_minor: 12_000_000n },
  ],
};

type Args = {
  project?: "filled" | "missing";
  state?: "loading" | "error";
  sheet?: "purchase" | "arv" | "value" | "rehab" | "loans" | null;
  viewer?: boolean;
};

function Section({ project = "filled", state, sheet = null, viewer = false }: Args) {
  return (
    <StoryRoute entry="/projects/p1" viewer={viewer}>
      <p className="ui-page-pad t-hint">נתוני דוגמה · Example data</p>
      <ProjectInvestmentSection
        projectId="p1"
        sample={state == null ? (project === "filled" ? FILLED_PROJECT : MISSING_PROJECT) : undefined}
        sampleState={state}
        sampleCategories={CATEGORIES}
        initialSheet={sheet}
      />
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Project investment",
  component: Section,
  parameters: { flowRouter: false },
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "dark" } };
const se = { parameters: { flowRouter: false, viewport: { defaultViewport: "flow375-se" } } };

export const Card: Story = {};
export const CardMissing: Story = { args: { project: "missing" } };
export const CardViewer: Story = { args: { project: "missing", viewer: true } };
export const CardLoading: Story = { args: { state: "loading" } };
export const CardError: Story = { args: { state: "error" } };
export const EditPurchase: Story = { args: { sheet: "purchase" } };
export const EditValue: Story = { args: { sheet: "value" } };
export const EditValueSE: Story = { args: { sheet: "value" }, ...se };
export const EditValueDark: Story = { args: { sheet: "value" }, ...dark };
export const AddArv: Story = { args: { project: "missing", sheet: "arv" } };
export const RehabList: Story = { args: { sheet: "rehab" } };
export const RehabListSE: Story = { args: { sheet: "rehab" }, ...se };
export const RehabListDark: Story = { args: { sheet: "rehab" }, ...dark };
export const LoansList: Story = { args: { project: "missing", sheet: "loans" } };
