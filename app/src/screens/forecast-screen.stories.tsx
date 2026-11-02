import type { Meta, StoryObj } from "@storybook/react-vite";
import { type BoardForecastVariant, monthForecastBoardSample, monthForecastSample, type ForecastSampleKind } from "../forecast-sample";
import { expect, userEvent, waitFor, within } from "storybook/test";
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

/** לפי פרויקט (FLOW-1004): a section per project with its net, the general costs last. */
export const ForecastByProject: Story = { name: "Forecast · by project", render: () => <BoardForecast variant="project" /> };
/** FLOW-970: the forecast's read failed: the title stays, the failure card says what happened, with נסו שוב and צריך עזרה?. */
export const ForecastFailed: Story = { name: "Forecast · failed", render: () => <BoardForecast variant="failed" /> };
/** FLOW-970: offline, the board's figures stay with the moment they are from. */
export const ForecastOffline: Story = { name: "Forecast · offline", render: () => <BoardForecast variant="offline" /> };

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

/** The board (by project) with a line the owner added to Elm St this month, as a project's צפי page adds it (FLOW-1010). */
function withAddedLine() {
  const sample = monthForecastBoardSample("project");
  const base = sample.data.build.income[0];
  if (base == null) return sample;
  const added = { ...base, key: "added:e-1", kind: "added" as const, name: "Parking spots", usual: 50_000n, minor: 50_000n, project_id: "p-elm", project_name: "Elm St", pace: "once", line_start: "2026-10", overridden: false, moved_out: false, late_days: 0, expected_on: null, due_on: null };
  const build = { ...sample.data.build, items: [...sample.data.build.items, added], income: [added, ...sample.data.build.income] };
  return { ...sample, data: { ...sample.data, build } };
}

/**
 * FLOW-1012: on an added line's page, כל כמה זמן is a draft like the amount and the date: after a pick the
 * hint says the project's line changes from this month on, and שמירת השינוי בצפי writes it.
 */
export const ChangeItemPace: Story = {
  name: "Forecast · change an added line, pace picked",
  render: () => (
    <StoryRoute entry="/forecast/item/added%3Ae-1" tabs>
      <ForecastScreen sample={withAddedLine()} />
    </StoryRoute>
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("button", { name: "כל כמה זמן: פעם אחת" }));
    const sheet = await body.findByRole("dialog", { name: "כל כמה זמן" });
    await waitFor(async () => { await expect(getComputedStyle(sheet).pointerEvents).not.toBe("none"); });
    await userEvent.click(within(sheet).getByRole("radio", { name: /^כל חודש(?!יים)/u }));
    await expect(await body.findByRole("button", { name: "כל כמה זמן: כל חודש" })).toBeInTheDocument();
    await expect(body.getByText("משנה את הצפי של אוקטובר, ואת השורה בצפי של הפרויקט מאוקטובר והלאה.")).toBeInTheDocument();
  },
};
