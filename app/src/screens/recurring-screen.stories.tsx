import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { RecurringList, RecurringListEmpty } from "../ui/recurring-list";
import { RECURRING_FIXTURE, RECURRING_MISSING_FIXTURE } from "../recurring-sample";
import type { ScheduleRow } from "../recurring-schedule";
import { RecurringSkeleton } from "../ui/screen-skeletons";
import { StoryRoute } from "../ui/story-route";
import { longHebrew, withToasts } from "../ui/story-support";
import { RecurringScreen, recurringView } from "./recurring-screen";
import { ForecastAddLine } from "./forecast-add-line";

/** FLOW-447, FLOW-1048 (V3-Recurring): the list on the rule-25 fixture (invented charges). The viewport toolbar sets the width. */
const NOW = new Date("2026-10-11T12:00:00Z");

const addLine = <ForecastAddLine month="2026-10" projects={[{ id: "p-elm", name: "Elm St" }, { id: "office", name: "כללי" }]} search="" back="recurring" pace="month" label="הוספת קבוע" />;

/** Long names, and the fixture twice over, for the long-content state (V3-States). */
const LONG: ScheduleRow[] = [
  ...RECURRING_FIXTURE.map((row, index) => (index % 3 === 0 ? { ...row, party_name: `${row.party_name} ${longHebrew}` } : row)),
  ...RECURRING_FIXTURE.map((row) => ({ ...row, party_id: `${row.party_id}-2`, party_name: `${row.party_name} 2` })),
];

function clearHidden() {
  try {
    window.localStorage.removeItem("flow.attention.recurring");
  } catch {
    // No storage: nothing to clear.
  }
}

function Screen(props: Partial<Parameters<typeof RecurringScreen>[0]>) {
  return (
    <StoryRoute entry="/recurring">
      <RecurringScreen now={NOW} sample={RECURRING_FIXTURE} missing={RECURRING_MISSING_FIXTURE} {...props} />
    </StoryRoute>
  );
}

const meta = {
  title: "Screens/Recurring",
  parameters: { flowRouter: false },
  beforeEach: clearHidden,
  render: () => <Screen />,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The figure, the "לא הגיעו" cards, then the groups under one-line heads with a status mark on each row. */
export const Default: Story = {};

/** FLOW-1011: הוספת קבוע, at the end of the list: a project, then its add page at כל חודש. */
export const AddLine: Story = {
  parameters: { flowRouter: true },
  decorators: [withToasts],
  render: () => <RecurringList {...recurringView(RECURRING_FIXTURE, "2026-10-11")} addLine={addLine} />,
};

/** While the schedule loads. */
/** FLOW-1081: Brightline Power taken out of October's forecast: "לא צפוי באוקטובר", off the late cards and עוד לשלם. */
export const SkippedThisMonth: Story = {
  parameters: { flowRouter: true },
  decorators: [withToasts],
  render: () => <RecurringList {...recurringView(RECURRING_FIXTURE, "2026-10-11", null, undefined, "", { skipped: new Set(["party:expense:power:USD"]), base: "USD", monthLabel: "אוקטובר" })} />,
};

export const Loading: Story = { render: () => <RecurringSkeleton /> };

/** FLOW-1014: no recurring charge yet: the empty screen's one action is the add row. */
export const EmptyAddLine: Story = { parameters: { flowRouter: true }, render: () => <RecurringListEmpty addLine={addLine} /> };

/** FLOW-963: offline with the rows on screen, the line under the head says which moment they are from. */
export const Offline: Story = { render: () => <Screen offlineSince={Date.parse("2026-10-11T06:41:00Z")} /> };

/** FLOW-963: the schedule read failed: the title stays, with what happened, נסו שוב and צריך עזרה?. */
export const Failed: Story = { render: () => <Screen failed /> };

/** Long names and many rows (V3-States). */
export const LongContent: Story = { render: () => <Screen sample={LONG} /> };

/** Scrolled: the surface-coloured compact bar with what is still to pay, and the sticky group heads under it. */
export const Scrolled: Story = {
  render: () => <Screen sample={LONG} />,
  play: async ({ canvasElement }) => {
    window.scrollTo({ top: 900, behavior: "instant" });
    await waitFor(() => expect(canvasElement.ownerDocument.documentElement).toHaveAttribute("data-compact-bar"));
  },
};

/** One late card hidden: the head offers "1 הוסתרו · הצגה". */
export const LateSomeHidden: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first] = canvas.getAllByRole("button", { name: /^הסתרה: / });
    await userEvent.click(first as HTMLElement);
    await expect(await canvas.findByRole("button", { name: "1 הוסתרו · הצגה" })).toBeVisible();
  },
};

/** Every late card hidden: one line, "אין מה לטפל · הכול נסקר", with הצגת הכול. */
export const LateAllHidden: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const button of canvas.getAllByRole("button", { name: /^הסתרה: / })) await userEvent.click(button);
    await waitFor(() => expect(canvas.getByText(/אין מה לטפל/)).toBeVisible(), { timeout: 3000 });
  },
};
