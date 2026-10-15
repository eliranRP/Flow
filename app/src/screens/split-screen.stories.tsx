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

function splitStory(render: () => ReactElement): Story {
  return { render };
}

/** The line on one project: no parts yet, the whole amount is the rest. */
const splitDefault = splitStory(() => <SplitStory rest="a" />);
export const SplitDefault: Story = splitDefault;

/** Exact amounts: one part to the cent, the rest on the line's project. */
const splitExact = splitStory(() => <SplitStory rest="a" parts={[{ projectId: "b", value: "8000" }]} />);
export const SplitExact: Story = splitExact;

/** A percent part and an amount part side by side. */
const splitMixed = splitStory(() => (
  <SplitStory rest="a" parts={[{ projectId: "b", unit: "percent", value: "25" }, { projectId: "c", value: "1500.50" }]} />
));
export const SplitMixed: Story = splitMixed;

/** Parts past the line, after a first ✕: the part and the footer say by how much. */
const splitOver = splitStory(() => (
  <SplitStory rest="a" warned parts={[{ projectId: "b", value: "20000" }, { projectId: "c", value: "10000" }]} />
));
export const SplitOver: Story = splitOver;

/** A shared line with no project: the rest asks for one. */
const splitNoRest = splitStory(() => <SplitStory rest={null} warned parts={[{ projectId: "b", value: "8000" }]} />);
export const SplitNoRestProject: Story = splitNoRest;

const splitSaving = splitStory(() => <SplitStory rest="a" saving parts={[{ projectId: "b", value: "8000" }]} />);
export const SplitSaving: Story = splitSaving;
