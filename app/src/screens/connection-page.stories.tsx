import type { Meta, StoryObj } from "@storybook/react-vite";
import { StoryRoute } from "../ui/story-route";
import { ViewerPreview } from "../use-is-viewer";
import { ExampleBar } from "../ui/screen-stories-support";
import { ConnectionDetailPage } from "./connection-pages";

/** FLOW-512: the SUMIT page (Mercury's is in mercury-connection-screen.stories.tsx). Invented company numbers only. */
const meta = {
  title: "Screens/Connection pages",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function sumit(sample: Parameters<typeof ConnectionDetailPage>[0]["sample"]) {
  return (
    <StoryRoute entry="/settings/connections/sumit" tabs>
      <ExampleBar />
      <ConnectionDetailPage provider="sumit" sample={sample} />
    </StoryRoute>
  );
}

export const SumitNew: Story = { name: "SUMIT, new", render: () => sumit({ state: "new" }) };

/** Decision 0223: חיבור is never greyed out; a tap with something missing says what. */
export const SumitMissing: Story = { name: "SUMIT, a tap with the key missing", render: () => sumit({ state: "new", keyError: "short" }) };

/** Decision 0223: a key SUMIT refuses is said under the field, and the button reads חיבור מחדש. */
export const SumitRejected: Story = { name: "SUMIT, key rejected", render: () => sumit({ state: "new", companyId: "1234567", keyError: "rejected" }) };

export const SumitProblem: Story = {
  name: "SUMIT, key replaced",
  render: () => sumit({ state: "problem", companyId: "1234567" }),
};

export const SumitConnected: Story = {
  name: "SUMIT, connected",
  render: () => sumit({ state: "connected", companyId: "1234567", lastSync: "היום, 06:05" }),
};

export const SumitViewer: Story = {
  name: "SUMIT, viewer",
  render: () => (
    <StoryRoute entry="/settings/connections/sumit" tabs>
      <ExampleBar />
      <ViewerPreview>
        <ConnectionDetailPage provider="sumit" sample={{ state: "new" }} />
      </ViewerPreview>
    </StoryRoute>
  ),
};
