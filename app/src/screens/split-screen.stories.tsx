import { type ReactElement } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { SplitScreen } from "./flow-screens";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const splitProjects = [
  { id: "a", name: "בניין מגורים חולון", incomeAgorot: 20_000_000n },
  { id: "b", name: "מגדל משרדים פ״ת", incomeAgorot: 15_000_000n },
  { id: "c", name: "וילה רעננה", incomeAgorot: 10_000_000n },
  { id: "d", name: "בית פרטי כפר סבא", incomeAgorot: 5_000_000n },
];

function SplitStory({
  method,
  shares,
  chosen,
  projects = splitProjects,
  saving = false,
}: {
  method?: "equal" | "chosen" | "income" | "manual" | null;
  shares?: Record<string, string>;
  chosen?: string[];
  projects?: typeof splitProjects;
  saving?: boolean;
} = {}) {
  return (
    <StoryRoute entry="/transactions/t1/split">
      <ExampleBar />
      <SplitScreen
        sampleMeta="חשמל · 12/09/2026"
        sampleAmount={100_000n}
        sampleProjects={projects}
        sampleMethod={method}
        sampleShares={shares}
        sampleChosen={chosen}
        sampleSaving={saving}
      />
    </StoryRoute>
  );
}

function splitQuadrant(render: () => ReactElement): { base: Story; dark: Story; narrow: Story; darkNarrow: Story } {
  return {
    base: { render },
    dark: { render, globals: { theme: "dark" } },
    narrow: { render, parameters: { viewport: { defaultViewport: "flow320" } } },
    darkNarrow: { render, globals: { theme: "dark" }, parameters: { viewport: { defaultViewport: "flow320" } } },
  };
}

const splitDefault = splitQuadrant(() => <SplitStory />);
export const SplitDefault: Story = splitDefault.base;
export const SplitDefaultDark: Story = splitDefault.dark;
export const SplitDefault320: Story = splitDefault.narrow;
export const SplitDefaultDark320: Story = splitDefault.darkNarrow;

const splitAll = splitQuadrant(() => <SplitStory method="equal" />);
export const SplitAll: Story = splitAll.base;
export const SplitAllDark: Story = splitAll.dark;
export const SplitAll320: Story = splitAll.narrow;
export const SplitAllDark320: Story = splitAll.darkNarrow;

const splitSelected2 = splitQuadrant(() => <SplitStory method="chosen" chosen={["a", "c"]} />);
export const SplitSelected2: Story = splitSelected2.base;
export const SplitSelected2Dark: Story = splitSelected2.dark;
export const SplitSelected2_320: Story = splitSelected2.narrow;
export const SplitSelected2Dark320: Story = splitSelected2.darkNarrow;

const splitSelectedInvalid = splitQuadrant(() => <SplitStory method="chosen" chosen={["a"]} />);
export const SplitSelectedInvalid: Story = splitSelectedInvalid.base;
export const SplitSelectedInvalidDark: Story = splitSelectedInvalid.dark;
export const SplitSelectedInvalid320: Story = splitSelectedInvalid.narrow;
export const SplitSelectedInvalidDark320: Story = splitSelectedInvalid.darkNarrow;

const splitIncomeDisabled = splitQuadrant(() => (
  <SplitStory projects={splitProjects.map((project) => ({ ...project, incomeAgorot: 0n }))} />
));
export const SplitIncomeDisabled: Story = splitIncomeDisabled.base;
export const SplitIncomeDisabledDark: Story = splitIncomeDisabled.dark;
export const SplitIncomeDisabled320: Story = splitIncomeDisabled.narrow;
export const SplitIncomeDisabledDark320: Story = splitIncomeDisabled.darkNarrow;

const splitManualValid = splitQuadrant(() => (
  <SplitStory method="manual" shares={{ a: "25", b: "25", c: "25", d: "25" }} />
));
export const SplitManualValid: Story = splitManualValid.base;
export const SplitManualValidDark: Story = splitManualValid.dark;
export const SplitManualValid320: Story = splitManualValid.narrow;
export const SplitManualValidDark320: Story = splitManualValid.darkNarrow;

const splitManualOver = splitQuadrant(() => (
  <SplitStory method="manual" shares={{ a: "70", b: "50" }} />
));
export const SplitManualOver: Story = splitManualOver.base;
export const SplitManualOverDark: Story = splitManualOver.dark;
export const SplitManualOver320: Story = splitManualOver.narrow;
export const SplitManualOverDark320: Story = splitManualOver.darkNarrow;

const splitSaving = splitQuadrant(() => <SplitStory method="equal" saving />);
export const SplitSaving: Story = splitSaving.base;
export const SplitSavingDark: Story = splitSaving.dark;
export const SplitSaving320: Story = splitSaving.narrow;
export const SplitSavingDark320: Story = splitSaving.darkNarrow;
