import type { Meta, StoryObj } from "@storybook/react";
import { monthForecastSample, type ForecastSampleKind } from "../forecast-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { ForecastScreen } from "./forecast-screen";

const meta: Meta<{ kind: ForecastSampleKind }> = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
  argTypes: { kind: { control: "inline-radio", options: ["positive", "negative", "moved"] } },
};

export default meta;
type Story = StoryObj<{ kind: ForecastSampleKind }>;

/** FLOW-141: the forecast opened from Home's line. Args are plain strings; the sample builds the figures. */
function Forecast({ kind }: { kind: ForecastSampleKind }) {
  return (
    <StoryRoute entry="/forecast" tabs>
      <ExampleBar />
      <ForecastScreen sample={monthForecastSample(kind)} />
    </StoryRoute>
  );
}

export const Positive: Story = { name: "Forecast · positive", args: { kind: "positive" }, render: (args) => <Forecast kind={args.kind} /> };
export const Negative: Story = { name: "Forecast · negative", args: { kind: "negative" }, render: (args) => <Forecast kind={args.kind} /> };
export const MovedItem: Story = { name: "Forecast · moved to next month", args: { kind: "moved" }, render: (args) => <Forecast kind={args.kind} /> };
