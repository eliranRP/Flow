import type { Meta, StoryObj } from "@storybook/react";
import { StoryRoute } from "../ui/story-route";
import { ViewerPreview } from "../use-is-viewer";
import { ExampleBar } from "../ui/screen-stories-support";
import { ConnectionDetailPage } from "./connection-pages";

/** FLOW-512: the SUMIT and Mercury pages. Invented company numbers and account labels only. */
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

function mercury(sample: Parameters<typeof ConnectionDetailPage>[0]["sample"]) {
  return (
    <StoryRoute entry="/settings/connections/mercury" tabs>
      <ExampleBar />
      <ConnectionDetailPage provider="mercury" sample={sample} />
    </StoryRoute>
  );
}

export const SumitNew: Story = { name: "SUMIT, new", render: () => sumit({ state: "new" }) };

export const SumitProblem: Story = {
  name: "SUMIT, key replaced",
  render: () => sumit({ state: "problem", companyId: "1234567" }),
};

export const SumitConnecting: Story = {
  name: "SUMIT, connecting",
  render: () => sumit({ state: "new", companyId: "1234567", busy: true }),
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

export const SumitLoading: Story = { name: "SUMIT, loading", render: () => sumit({ state: "loading" }) };

export const MercuryNew: Story = { name: "Mercury, new", render: () => mercury({ state: "new" }) };

export const MercuryConnected: Story = {
  name: "Mercury, connected",
  render: () => mercury({ state: "connected", accounts: "עסק ראשי · 0042", lastSync: "היום, 06:10" }),
};

export const MercuryProblem: Story = {
  name: "Mercury, key replaced",
  render: () => mercury({ state: "problem" }),
};
