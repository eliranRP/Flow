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
  { id: "a", name: "בניין מגורים חולון" },
  { id: "b", name: "מגדל משרדים פ״ת" },
  { id: "c", name: "וילה רעננה" },
  { id: "d", name: "בית פרטי כפר סבא" },
];

type Part = { projectId: string; unit?: "percent" | "amount"; value: string };

function SplitStory({
  parts,
  rest,
  saving = false,
  warned = false,
}: {
  parts?: Part[];
  rest?: string | null;
  saving?: boolean;
  warned?: boolean;
} = {}) {
  return (
    <StoryRoute entry="/transactions/t1/split">
      <ExampleBar />
      <SplitScreen
        sampleMeta="חשמל · 12/09/2026"
        sampleAmount={2_866_316n}
        sampleProjects={splitProjects}
        sampleParts={parts}
        sampleRestProject={rest}
        sampleSaving={saving}
        sampleWarned={warned}
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

/** The line on one project: no parts yet, the whole amount is the rest. */
const splitDefault = splitQuadrant(() => <SplitStory rest="a" />);
export const SplitDefault: Story = splitDefault.base;
export const SplitDefaultDark: Story = splitDefault.dark;
export const SplitDefault320: Story = splitDefault.narrow;
export const SplitDefaultDark320: Story = splitDefault.darkNarrow;

/** Exact amounts: one part to the cent, the rest on the line's project. */
const splitExact = splitQuadrant(() => <SplitStory rest="a" parts={[{ projectId: "b", value: "8000" }]} />);
export const SplitExact: Story = splitExact.base;
export const SplitExactDark: Story = splitExact.dark;
export const SplitExact320: Story = splitExact.narrow;
export const SplitExactDark320: Story = splitExact.darkNarrow;

/** A percent part and an amount part side by side. */
const splitMixed = splitQuadrant(() => (
  <SplitStory rest="a" parts={[{ projectId: "b", unit: "percent", value: "25" }, { projectId: "c", value: "1500.50" }]} />
));
export const SplitMixed: Story = splitMixed.base;
export const SplitMixedDark: Story = splitMixed.dark;
export const SplitMixed320: Story = splitMixed.narrow;
export const SplitMixedDark320: Story = splitMixed.darkNarrow;

/** Parts past the line, after a first ✕: the part and the footer say by how much. */
const splitOver = splitQuadrant(() => (
  <SplitStory rest="a" warned parts={[{ projectId: "b", value: "20000" }, { projectId: "c", value: "10000" }]} />
));
export const SplitOver: Story = splitOver.base;
export const SplitOverDark: Story = splitOver.dark;
export const SplitOver320: Story = splitOver.narrow;
export const SplitOverDark320: Story = splitOver.darkNarrow;

/** A shared line with no project: the rest asks for one. */
const splitNoRest = splitQuadrant(() => <SplitStory rest={null} warned parts={[{ projectId: "b", value: "8000" }]} />);
export const SplitNoRestProject: Story = splitNoRest.base;
export const SplitNoRestProjectDark: Story = splitNoRest.dark;
export const SplitNoRestProject320: Story = splitNoRest.narrow;
export const SplitNoRestProjectDark320: Story = splitNoRest.darkNarrow;

const splitSaving = splitQuadrant(() => <SplitStory rest="a" saving parts={[{ projectId: "b", value: "8000" }]} />);
export const SplitSaving: Story = splitSaving.base;
export const SplitSavingDark: Story = splitSaving.dark;
export const SplitSaving320: Story = splitSaving.narrow;
export const SplitSavingDark320: Story = splitSaving.darkNarrow;
