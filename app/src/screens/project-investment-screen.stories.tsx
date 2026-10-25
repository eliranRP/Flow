import type { Meta, StoryObj } from "@storybook/react-vite";
import { birchLaneInvestment, birchLaneNegativeInvestment, birchLaneNoArvInvestment, birchLaneRehabCategories } from "../dev/investment-sample";
import { project as sampleProject } from "../dev/project-cash-sample";
import { StoryRoute } from "../ui/story-route";
import { ProjectInvestmentScreen } from "./project-investment-screen";
import type { ProjectInvestment } from "./project-investment-data";

/** FLOW-446. Invented flip, the board's figures; value only (no ARV), under water, and the two sheets. */
const VALUE_ONLY: ProjectInvestment = {
  ...birchLaneInvestment,
  figures: birchLaneInvestment.figures && { ...birchLaneInvestment.figures, arvMinor: null, forcedEquityMinor: null, purchaseMinor: null },
  loans: [],
};

const DATA = { flip: birchLaneInvestment, valueOnly: VALUE_ONLY, noArv: birchLaneNoArvInvestment, negative: birchLaneNegativeInvestment };

type Args = {
  data?: keyof typeof DATA;
  sheet?: "purchase" | "arv" | "value" | "rehab" | null;
  viewer?: boolean;
};

function Screen({ data = "flip", sheet = null, viewer = false }: Args) {
  return (
    <StoryRoute entry="/projects/p1/investment" viewer={viewer}>
      <ProjectInvestmentScreen
        sample={sampleProject}
        sampleInvestment={DATA[data]}
        sampleCategories={birchLaneRehabCategories}
        initialSheet={sheet}
        backTo="/projects/p1"
        today="2026-10-17"
      />
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Project investment",
  component: Screen,
  parameters: { flowRouter: false },
} satisfies Meta<typeof Screen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Flip: Story = {};
export const MissingArv: Story = { args: { data: "noArv" } };
export const Negative: Story = { args: { data: "negative" } };
export const Viewer: Story = { args: { data: "noArv", viewer: true } };
export const EditArv: Story = { args: { sheet: "arv" } };
export const RehabBreakdown: Story = { args: { sheet: "rehab" } };
