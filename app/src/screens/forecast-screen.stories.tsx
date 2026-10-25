import type { Meta, StoryObj } from "@storybook/react-vite";
import { type BoardForecastVariant, monthForecastBoardSample, monthForecastSample, type ForecastSampleKind } from "../forecast-sample";
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
/** After a change: the moved row sits in לא החודש and the reset line counts it (FLOW-141). */
export const MovedItem: Story = { name: "Forecast · moved to next month, reset line", args: { kind: "moved" }, render: (args) => <Forecast kind={args.kind} /> };

/** The board's frames on the invented USD company: the changed list (one invoice moved) and everything arrived (FLOW-141b). */
function BoardForecast({ variant }: { variant: BoardForecastVariant }) {
  return (
    <StoryRoute entry="/forecast" tabs>
      <ExampleBar />
      <ForecastScreen sample={monthForecastBoardSample(variant)} />
    </StoryRoute>
  );
}

/** The MonthForecast board (preset cash2): תזרים צפוי, the month's end, the card's whole sum and the chart with October in progress. */
export const Board: Story = { name: "Forecast · board, card and chart", render: () => <BoardForecast variant="board" /> };
export const Changed: Story = { name: "Forecast · changed, reset line", render: () => <BoardForecast variant="changed" /> };
export const AllArrived: Story = { name: "Forecast · all arrived", render: () => <BoardForecast variant="empty" /> };
/** לפי קטגוריה: each category's month so far and still to come, with the rent category open (MonthForecastCategory). */
export const ForecastByCategory: Story = { name: "Forecast · by category", render: () => <BoardForecast variant="category" /> };

/** A row's page over the list (MonthForecastEdit): the board's late invoice. Its save and the moved state are the screen's. */
function ItemPage({ when }: { when: boolean }) {
  return (
    <StoryRoute entry="/forecast/item/invoice%3Ainv-1043" tabs>
      <ForecastScreen sample={monthForecastBoardSample("board")} openWhen={when} />
    </StoryRoute>
  );
}

export const ChangeItem: Story = { name: "Forecast · change an item", render: () => <ItemPage when={false} /> };
/** The page's מתי צפוי sheet (MonthForecastWhen): the three choices, this week picked. */
export const ChangeItemWhen: Story = { name: "Forecast · change an item, when", render: () => <ItemPage when /> };
