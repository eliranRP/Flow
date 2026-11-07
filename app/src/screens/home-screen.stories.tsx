import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { attentionRows, CashHome, HomeScreen } from "./HomeScreen";
import { sampleCashMonths, sampleCashToDay, sampleQuietCashMonths } from "../dev/cash-sample";
import { homeActivityLines } from "../dev/home-activity-sample";
import { FAR_MONTH_KEY, FUTURE_CURRENT_KEY, FUTURE_MONTH_KEY, sampleHomeFuture } from "../dev/home-future-sample";
import { HOME_NEXT_MONTH_SAMPLE } from "../dev/home-next-month-sample";
import type { ActivityFilter, ActivitySkip, HomeActivityData, HomeFuture } from "./home-activity";
import { RECURRING_FIXTURE } from "../recurring-sample";
import { shiftMonthKey } from "../period";
import { HEBREW_MONTHS, israelToday } from "../ui/date-math";
import { StoryRoute } from "../ui/story-route";
import { oneLineAttention } from "../ui/story-support";
import { BandCompany } from "../ui/top-band";
import { exampleOnBand } from "../ui/screen-stories-support";

const meta = {
  title: "Screens/Routes",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const HomeLoading: Story = {
  render: () => (
    <StoryRoute entry="/?preview=loading" tabs>
      <HomeScreen example={exampleOnBand} />
    </StoryRoute>
  ),
};

/** The hidden attention rows a story starts with (flow.attention.home); every story sets its own, so none leaks into the next. */
function useHiddenRows(hidden: Record<string, string> | null) {
  useState(() => {
    try {
      if (hidden == null) window.localStorage.removeItem("flow.attention.home");
      else window.localStorage.setItem("flow.attention.home", JSON.stringify(hidden));
    } catch {
      // Storage blocked: the story shows every row.
    }
    return null;
  });
}

/**
 * FLOW-1036: the month's activity as Home reads it: the recurring schedule (recurring-sample.ts) and this month's
 * lines, in the sample's base currency (ILS). Invented names and figures.
 */
function sampleActivity(over: Partial<HomeActivityData> = {}): HomeActivityData {
  const currentKey = israelToday().slice(0, 7);
  return {
    schedule: RECURRING_FIXTURE.map((row) => ({ ...row, currency: "ILS" })),
    scheduleFailed: false,
    lines: homeActivityLines(currentKey, { currency: "ILS" }),
    linesFailed: false,
    onRetry: () => undefined,
    ...over,
  };
}

/** FLOW-1056: a past month's activity: its own lines (no schedule), past their first page. Invented names and figures. */
function samplePastActivity(monthKey: string, over: Partial<HomeActivityData> = {}): HomeActivityData {
  return {
    schedule: null,
    scheduleFailed: false,
    lines: homeActivityLines(monthKey, { currency: "ILS" }),
    linesFailed: false,
    onRetry: () => undefined,
    past: { more: true },
    ...over,
  };
}

// FLOW-321. The pending card on Home: a row to Review and a row to Unpaid, each only when it has items.
function AttentionHome({ pending, unpaidCount, unpaidGross }: { pending: number; unpaidCount: number; unpaidGross: bigint }) {
  const currentKey = israelToday().slice(0, 7);
  useHiddenRows(null);
  return (
    <StoryRoute entry="/" tabs>
      <CashHome
        data={sampleCashMonths()}
        monthKey={currentKey}
        currentKey={currentKey}
        previewing={false}
        search=""
        attention={attentionRows({ pending, unpaidCount, unpaidGross, search: "" })}
        activity={sampleActivity()}
        example={exampleOnBand}
        onStepMonth={() => undefined}
      />
    </StoryRoute>
  );
}


export const HomeAttentionBoth: Story = {
  name: "Home attention, review and unpaid",
  render: () => <AttentionHome pending={7} unpaidCount={3} unpaidGross={2_340_000n} />,
};
export const HomeAttentionReviewOnly: Story = {
  name: "Home attention, review only",
  render: () => <AttentionHome pending={7} unpaidCount={0} unpaidGross={0n} />,
};
export const HomeAttentionUnpaidOnly: Story = {
  name: "Home attention, unpaid only",
  render: () => <AttentionHome pending={0} unpaidCount={3} unpaidGross={2_340_000n} />,
};
export const HomeAttentionSingular: Story = {
  name: "Home attention, one of each",
  render: () => <AttentionHome pending={1} unpaidCount={1} unpaidGross={468_000n} />,
};

/**
 * FLOW-364 / FLOW-1036: Home's band with the month and its figures, the attention cards and the month's activity.
 * Invented figures. `review` false leaves the review card out, so every card can be hidden.
 */
function CashHomeStory({
  monthBack = 0,
  pastActivity,
  attention = true,
  review = true,
  hidden = null,
  activity = sampleActivity(),
  filter = "all",
  initialDrawerOpen = false,
  quiet = false,
  offlineSince = null,
  recurringTip = false,
  late = recurringTip ? 1 : 0,
  forecast = null,
  forecastPending = false,
  example = true,
  skip,
}: {
  monthBack?: number;
  /** A past month's activity (its lines); the sample's by default. */
  pastActivity?: HomeActivityData;
  attention?: boolean;
  review?: boolean;
  hidden?: Record<string, string> | null;
  activity?: HomeActivityData | null;
  filter?: ActivityFilter;
  initialDrawerOpen?: boolean;
  quiet?: boolean;
  offlineSince?: number | null;
  recurringTip?: boolean;
  late?: number;
  forecast?: bigint | null;
  forecastPending?: boolean;
  /** The "Example data" strip on the band; the board comparisons draw the band without it (FLOW-1052). */
  example?: boolean;
  /** FLOW-1079: the swipes out of this month's forecast. */
  skip?: ActivitySkip;
}) {
  const data = quiet ? sampleQuietCashMonths() : sampleCashMonths();
  const currentKey = israelToday().slice(0, 7);
  useHiddenRows(hidden);
  return (
    <StoryRoute entry="/" tabs>
      <CashHome
        data={data}
        monthKey={shiftMonthKey(currentKey, -monthBack)}
        currentKey={currentKey}
        previewing={false}
        search=""
        attention={attention ? attentionRows({ pending: review ? 7 : 0, transfers: 2, unpaidCount: 3, unpaidGross: 460_000n, missingCount: late, search: "" }) : []}
        activity={monthBack > 0 ? pastActivity ?? samplePastActivity(shiftMonthKey(currentKey, -monthBack)) : activity}
        initialFilter={filter}
        withForecast
        example={example ? exampleOnBand : undefined}
        onStepMonth={() => undefined}
        initialDrawerOpen={initialDrawerOpen}
        drawerYearMonths={initialDrawerOpen ? data : undefined}
        sameDay={monthBack > 0 ? null : sampleCashToDay()}
        offlineSince={offlineSince}
        recurringTip={recurringTip}
        lateRecurring={late}
        forecast={forecast}
        forecastPending={forecastPending}
        skip={skip}
        company={<BandCompany name="Acme Test Co" onOpen={() => undefined} />}
      />
    </StoryRoute>
  );
}

/**
 * The current month: the company on row 1, the change chips on נכנס and יצא, the forecast row, the cards to review
 * (the review card has no X), then the month's activity. A first-time owner: no קבועים tip (FLOW-1015). FLOW-1052:
 * no "Example data" strip, so the band's edges compare with V3-Home's.
 */
export const HomeCurrent: Story = { render: () => <CashHomeStory forecast={1_250_000n} example={false} /> };

/**
 * FLOW-1095, FLOW-1103 (the owner, 2026-11-07): at every width search and הגדרות וחשבון wait in the ⋯ "עוד" sheet,
 * so the company's name keeps 96px or more; + and קבועים (with its late count) stay. The ⋯ opens from the keyboard
 * and its sheet holds both.
 */
async function bandMenuPlay(canvasElement: HTMLElement, width: number) {
  await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(width);
  const canvas = within(canvasElement);
  const more = await canvas.findByRole("button", { name: "עוד" });
  await expect(more.getBoundingClientRect().width).toBe(44);
  await expect(canvas.getByRole("link", { name: "קבועים, 2 לא הגיעו" })).toBeInTheDocument();
  await expect(canvas.queryByRole("link", { name: "חיפוש" })).toBeNull();
  await expect(canvas.queryByRole("link", { name: "הגדרות וחשבון" })).toBeNull();
  const name = canvasElement.querySelector(".ui-band-company-name");
  await expect(name?.getBoundingClientRect().width ?? 0).toBeGreaterThanOrEqual(96);
  more.focus();
  await userEvent.keyboard("{Enter}");
  const body = within(canvasElement.ownerDocument.body);
  const sheet = await body.findByRole("dialog", { name: "עוד" });
  await expect(within(sheet).getByRole("button", { name: /הגדרות וחשבון/u })).toBeInTheDocument();
  await expect(within(sheet).getByRole("button", { name: /חיפוש/u })).toBeInTheDocument();
}

export const HomeBandMenu320: Story = {
  name: "Home band, ⋯ menu at 320",
  render: () => <CashHomeStory forecast={1_250_000n} example={false} late={2} />,
  globals: { viewport: { value: "flow320", isRotated: false } },
  play: async ({ canvasElement }) => {
    await bandMenuPlay(canvasElement, 320);
  },
};

/** FLOW-1103: the owner's phone width. The same row as at 320: ⋯, קבועים, + and the company's name. */
export const HomeBandMenu393: Story = {
  name: "Home band, ⋯ menu at 393",
  render: () => <CashHomeStory forecast={1_250_000n} example={false} late={2} />,
  globals: { viewport: { value: "flow393", isRotated: false } },
  play: async ({ canvasElement }) => {
    await bandMenuPlay(canvasElement, 393);
  },
};

/** FLOW-1036: two cards hidden on this device; the head says so and brings them back. */
export const HomeAttentionSomeHidden: Story = {
  name: "Home attention, some hidden",
  render: () => <CashHomeStory hidden={{ transfers: "transfers:2", unpaid: "unpaid:3:460000" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "2 הוסתרו · הצגה" })).toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: /חשבוניות פתוחות/ })).toBeNull();
  },
};

/** FLOW-1036: with no review waiting, every card can be hidden: one line remains, with הצגת הכול (FLOW-1102). */
export const HomeAttentionAllHidden: Story = {
  name: "Home attention, all hidden",
  render: () => <CashHomeStory review={false} hidden={{ transfers: "transfers:2", unpaid: "unpaid:3:460000" }} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("אין מה לטפל · הכול נסקר")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "הצגת הכול" })).toBeInTheDocument();
  },
};

/** FLOW-1097 (the owner's choice B): at 320 each card is a short title and a tag on one line, the full title its name. */
export const HomeAttention320: Story = {
  name: "Home attention, one line at 320",
  render: () => <CashHomeStory late={2} />,
  globals: { viewport: { value: "flow320", isRotated: false } },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.ownerDocument.documentElement.clientWidth).toBeLessThanOrEqual(320);
    await within(canvasElement).findByRole("link", { name: /^3 חשבוניות פתוחות · /u });
    await expect(oneLineAttention(canvasElement)).toEqual(["לאישור · 7 פריטים", "לבדיקה · 2 העברות", "לגבייה · ₪4,600", "לא הגיעו · 2 חשבונות"]);
  },
};

/** FLOW-1036: an X slides its card out and folds it; the head counts the hidden card. */
export const HomeAttentionDismiss: Story = {
  name: "Home attention, an X hides a card",
  render: () => <CashHomeStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /^הסתרה: 3 חשבוניות פתוחות · /u }));
    await expect(await canvas.findByRole("button", { name: "1 הוסתרו · הצגה" })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "1 הוסתרו · הצגה" }));
    await expect(await canvas.findByRole("link", { name: /^3 חשבוניות פתוחות · /u })).toBeInTheDocument();
  },
};

/**
 * FLOW-1094 (the owner, 2026-11-07): an X shows "הוסתר" with ביטול for 4s, above the tab bar. Its ביטול brings
 * back that card only (attention-cards.test.tsx); the head's "N הוסתרו · הצגה" stays as the way back after.
 */
export const HomeAttentionHideToast: Story = {
  name: "Home attention, הוסתר with ביטול",
  render: () => <CashHomeStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: /^הסתרה: 3 חשבוניות פתוחות · /u }));
    const toast = await canvas.findByText("הוסתר");
    await expect(within(toast.closest(".ui-toast") ?? canvasElement).getByRole("button", { name: "ביטול" })).toBeInTheDocument();
    await expect(await canvas.findByRole("button", { name: "1 הוסתרו · הצגה" })).toBeInTheDocument();
    // Held on screen for the shot: a pointer over the toast pauses its time.
    await userEvent.hover(toast);
  },
};

/** FLOW-1036: the filter on קבועים: what is still due and the charges that arrived; the one-off lines hide. */
export const HomeFilterFixed: Story = {
  name: "Home activity, קבועים",
  render: () => <CashHomeStory filter="fixed" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "קבועים ששולמו" })).toBeInTheDocument();
    await expect(canvas.queryByRole("heading", { name: "חד-פעמי" })).toBeNull();
  },
};

/** FLOW-1036: the filter on נותר לשלם: only what is still due, late first, "איחר" in words. */
export const HomeFilterLeft: Story = {
  name: "Home activity, נותר לשלם",
  render: () => <CashHomeStory filter="left" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "נותר לשלם" })).toBeInTheDocument();
    await expect(canvas.queryByRole("heading", { name: "קבועים ששולמו" })).toBeNull();
    await expect(canvas.getAllByText("איחר").length).toBeGreaterThan(0);
  },
};

/**
 * FLOW-1079: a charge taken out of this month's forecast sits under הוצא מהצפי, crossed out; נותר לשלם swipes to
 * "לא החודש", and its first row peeks once (the first time on a phone). Invented names.
 */
export const HomeSkippedFromForecast: Story = {
  name: "Home activity, taken out of the forecast",
  render: () => (
    <CashHomeStory
      filter="left"
      skip={{
        skipped: new Set(["party:expense:insurance:ILS"]),
        monthLabel: "נובמבר",
        onSkip: () => undefined,
        onRestore: () => undefined,
        peek: true,
        onPeeked: () => undefined,
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "הוצא מהצפי" })).toBeInTheDocument();
    await expect(canvas.getByText("לא צפוי בנובמבר")).toBeInTheDocument();
  },
};

/** FLOW-1036: הכול with all three groups; a pick on the in-page filter changes them. */
export const HomeFilterAll: Story = {
  name: "Home activity, הכול",
  render: () => <CashHomeStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "חד-פעמי" })).toBeInTheDocument();
    const filter = canvas.getAllByRole("radiogroup", { name: "סינון תנועות" })[0];
    if (filter == null) throw new Error("no filter");
    await userEvent.click(within(filter).getByRole("radio", { name: "נותר לשלם" }));
    await waitFor(() => expect(canvas.queryByRole("heading", { name: "חד-פעמי" })).toBeNull());
    await userEvent.click(within(filter).getByRole("radio", { name: "הכול" }));
  },
};

/** FLOW-1036 (BUILD-PLAN §5): before the server says which lines recur, Home shows the two recurring groups only. */
export const HomeActivityNoFlag: Story = {
  name: "Home activity, before the recurring flag",
  render: () => <CashHomeStory activity={sampleActivity({ lines: homeActivityLines(israelToday().slice(0, 7), { flag: false, currency: "ILS" }) })} />,
};

/**
 * FLOW-1036: scrolled past the filter, it docks into the band's bar (the bar grows by its row) and the in-page copy
 * fades; a pick in the bar brings the list's top under it and the filter stays docked.
 */
export const HomeDocked: Story = {
  name: "Home activity, the filter docked",
  render: () => <CashHomeStory forecast={1_250_000n} example={false} />,
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const slot = canvasElement.querySelector<HTMLElement>(".ui-dock-slot");
    if (slot == null) throw new Error("no filter");
    window.scrollTo({ top: slot.getBoundingClientRect().top + window.scrollY, behavior: "instant" });
    const dock = () => doc.querySelector<HTMLElement>(".ui-compact-bar-band .ui-compact-dock");
    await waitFor(() => expect(dock()).toHaveAttribute("data-open"));
    await expect(slot).toHaveAttribute("data-docked");
    await waitFor(() => expect(doc.documentElement).toHaveAttribute("data-compact-dock", "on"));
    await userEvent.click(within(dock() as HTMLElement).getByRole("radio", { name: "קבועים" }));
    await waitFor(() => expect(within(dock() as HTMLElement).getByRole("radio", { name: "קבועים" })).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(canvasElement.querySelector("#home-act-once")).toBeNull());
    await expect(dock()).toHaveAttribute("data-open");
  },
};

/** FLOW-1036: a month with nothing yet: the activity says so in words; the filter stays. */
export const HomeEmptyMonth: Story = {
  name: "Home activity, empty month",
  render: () => <CashHomeStory attention={false} activity={sampleActivity({ schedule: [], lines: [] })} />,
};

/** FLOW-1036: the schedule's read is on its way: rows in the shape they land in. */
export const HomeActivityLoading: Story = {
  name: "Home activity, loading",
  render: () => <CashHomeStory activity={sampleActivity({ schedule: null, lines: null })} />,
};

/** FLOW-1036: the schedule's read failed: the list says so with a retry; the band and the one-off lines stay. */
export const HomeScheduleFailed: Story = {
  name: "Home activity, the schedule read failed",
  render: () => <CashHomeStory activity={sampleActivity({ schedule: null, scheduleFailed: true })} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("רשימת התנועות לא נטענה")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    await expect(canvasElement.querySelector(".ui-band")).not.toBeNull();
  },
};

/**
 * FLOW-1056: Home stepping between this month and next month, on the next-month sample (today 11/10/2026 there, so
 * October and November, in dollars; invented names). The arrows and the drawer move it; November is its forecast.
 */
function NextMonthStory({ start = FUTURE_MONTH_KEY, drawer = false, phase = "ready", empty = false }: { start?: string; drawer?: boolean; phase?: HomeFuture["phase"]; empty?: boolean }) {
  const [monthKey, setMonthKey] = useState(start);
  useHiddenRows(null);
  return (
    <StoryRoute entry="/" tabs>
      <CashHome
        data={HOME_NEXT_MONTH_SAMPLE.cash}
        monthKey={monthKey}
        currentKey={FUTURE_CURRENT_KEY}
        firstKey="2026-05"
        previewing={false}
        search=""
        attention={monthKey === FUTURE_CURRENT_KEY ? attentionRows({ pending: 7, unpaidCount: 3, unpaidGross: 460_000n, currency: "USD", search: "" }) : []}
        example={exampleOnBand}
        onStepMonth={setMonthKey}
        withForecast
        initialDrawerOpen={drawer}
        drawerYearMonths={HOME_NEXT_MONTH_SAMPLE.cash}
        future={monthKey > FUTURE_CURRENT_KEY ? sampleHomeFuture("", { phase, empty, month: monthKey }) : null}
      />
    </StoryRoute>
  );
}

/**
 * FLOW-1056 (owner): Home on next month: the band keeps its shape with the forecast's figures (תזרים צפוי, צפוי להיכנס
 * and צפוי לצאת with their lines), its foot row opens פירוט ועריכה, and the expected rows follow by project. No
 * דורש טיפול and no filter; the earlier arrow goes back to this month. FLOW-1066: the later one goes on to December,
 * and the foot row names the month's expected profit.
 */
export const HomeNextMonth: Story = {
  name: "Home on next month",
  render: () => <NextMonthStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("תזרים צפוי · נובמבר")).toBeInTheDocument();
    await expect(canvas.getByText("צפוי להיכנס")).toBeInTheDocument();
    await expect(canvas.getByText("צפוי לצאת")).toBeInTheDocument();
    const details = canvas.getByRole("link", { name: /^פירוט ועריכה, רווח צפוי בנובמבר /u });
    await expect(details).toHaveAttribute("href", "/forecast/next");
    await expect(within(details).getByText("רווח צפוי בנובמבר")).toBeInTheDocument();
    await expect(details.querySelector(".ui-home-forecast-value")?.textContent).toMatch(/\$/u);
    await expect(canvas.queryByText("הערכה · לפי קבועים, הלוואות וממוצע 6 חודשים")).toBeNull();
    await expect(canvas.getByRole("heading", { name: "הצפוי בנובמבר" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "כללי" })).toBeInTheDocument();
    await expect(canvas.queryByRole("radiogroup", { name: "סינון תנועות" })).toBeNull();
    await expect(canvas.queryByRole("heading", { name: "דורש טיפול" })).toBeNull();
    await expect(canvasElement.querySelector(".ui-band .ui-band-month-name")?.textContent).toBe("נובמבר 2026");
    await expect(canvas.getAllByRole("button", { name: "חודש הבא" })[0]).not.toHaveAttribute("aria-disabled");
    await userEvent.click(canvas.getAllByRole("button", { name: "חודש קודם" })[0] as HTMLElement);
    await waitFor(() => expect(canvasElement.querySelector(".ui-band .ui-band-month-name")?.textContent).toBe("אוקטובר 2026"));
    await userEvent.click(canvas.getAllByRole("button", { name: "חודש הבא" })[0] as HTMLElement);
    await waitFor(() => expect(canvas.getByText("תזרים צפוי · נובמבר")).toBeInTheDocument());
  },
};

/** FLOW-1056: next month while its forecast is read: the band's shape with bars for its figures, and rows to come. */
export const HomeNextMonthLoading: Story = { name: "Home on next month, loading", render: () => <NextMonthStory phase="loading" /> };

/** FLOW-1056: next month's forecast did not load: the band stays, the list says so with a retry. */
export const HomeNextMonthFailed: Story = {
  name: "Home on next month, failed",
  render: () => <NextMonthStory phase="failed" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("הצפי לנובמבר לא נטען")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    await expect(canvas.getByText("תזרים צפוי · נובמבר")).toBeInTheDocument();
  },
};

/** FLOW-1056: nothing expected next month yet: the band at zero, and the list says so in words. */
export const HomeNextMonthEmpty: Story = {
  name: "Home on next month, nothing expected",
  render: () => <NextMonthStory empty />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText("אין עוד צפי לנובמבר")).toBeInTheDocument();
  },
};

/** FLOW-1056: next month scrolled: the compact bar reads the month and its expected net; no filter docks. */
export const HomeNextMonthScrolled: Story = {
  name: "Home on next month, scrolled",
  render: () => <NextMonthStory />,
  play: async ({ canvasElement }) => {
    window.scrollTo(0, 400);
    const bar = await waitFor(() => {
      const node = canvasElement.ownerDocument.querySelector<HTMLElement>(".ui-compact-bar-band");
      if (node == null) throw new Error("no bar");
      return node;
    });
    await expect(bar.querySelector(".ui-compact-bar-centre-net")?.textContent).not.toBe("");
    await expect(bar.querySelector(".ui-compact-dock [role=radiogroup]")).toBeNull();
    window.scrollTo(0, 0);
  },
};

/** FLOW-1056 (owner): in the drawer, next month picks like any month: the drawer closes and Home shows that month. */
export const HomeDrawerNextMonth: Story = {
  name: "Home, next month picked in the drawer",
  render: () => <NextMonthStory start={FUTURE_CURRENT_KEY} drawer />,
  play: async ({ canvasElement }) => {
    const doc = within(canvasElement.ownerDocument.body);
    const dialog = await doc.findByRole("dialog", { name: "בחירת חודש" });
    const next = within(dialog).getByRole("button", { name: "נובמבר, תחזית" });
    await expect(next).toHaveClass("ui-month-cell-forecast");
    await userEvent.click(next);
    await waitFor(() => expect(doc.queryByRole("dialog", { name: "בחירת חודש" })).toBeNull());
    await waitFor(() => expect(within(canvasElement).getByText("תזרים צפוי · נובמבר")).toBeInTheDocument());
  },
};

/**
 * FLOW-1066 (owner, 2026-11-06: "I want to see the forecast revenue on any future month"): Home on a month after
 * next, March 2027: the same band, rows and פירוט ועריכה as next month, built for March, with the estimate's note in
 * the caption's place and the month's expected profit on the foot row. The arrows step on to the forecast's last
 * month (October 2027) and back one month at a time.
 */
export const HomeFarMonth: Story = {
  name: "Home on a month after next",
  render: () => <NextMonthStory start={FAR_MONTH_KEY} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("תזרים צפוי · מרץ")).toBeInTheDocument();
    await expect(canvas.getByText("הערכה · לפי קבועים, הלוואות וממוצע 6 חודשים")).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "הצפוי במרץ" })).toBeInTheDocument();
    const details = canvas.getByRole("link", { name: /^פירוט ועריכה, רווח צפוי במרץ /u });
    await expect(details).toHaveAttribute("href", "/forecast/next?month=2027-03");
    await expect(within(details).getByText("רווח צפוי במרץ")).toBeInTheDocument();
    await userEvent.click(canvas.getAllByRole("button", { name: "חודש קודם" })[0] as HTMLElement);
    await waitFor(() => expect(canvas.getByText("תזרים צפוי · פברואר")).toBeInTheDocument());
    await userEvent.click(canvas.getAllByRole("button", { name: "חודש הבא" })[0] as HTMLElement);
    await waitFor(() => expect(canvas.getByText("תזרים צפוי · מרץ")).toBeInTheDocument());
  },
};

/** FLOW-1066: the forecast's last month: the later arrow is off. */
export const HomeLastForecastMonth: Story = {
  name: "Home on the forecast's last month",
  render: () => <NextMonthStory start="2027-10" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("תזרים צפוי · אוקטובר")).toBeInTheDocument();
    await expect(canvas.getAllByRole("button", { name: "חודש הבא" })[0]).toHaveAttribute("aria-disabled", "true");
  },
};

/**
 * FLOW-1066: the drawer reaches past December: next year's months up to the forecast's last are dashed צפי cells to
 * pick, and the ones after it are faded and disabled.
 */
export const HomeDrawerNextYear: Story = {
  name: "Home, the drawer past December",
  render: () => <NextMonthStory start={FAR_MONTH_KEY} drawer />,
  play: async ({ canvasElement }) => {
    const doc = within(canvasElement.ownerDocument.body);
    const dialog = await doc.findByRole("dialog", { name: "בחירת חודש" });
    await expect(within(dialog).getByText("2027")).toBeInTheDocument();
    await expect(within(dialog).getByRole("button", { name: "ינואר, תחזית" })).toHaveClass("ui-month-cell-forecast");
    await expect(within(dialog).getByRole("button", { name: "מרץ, תחזית" })).toHaveAttribute("aria-current", "date");
    await expect(within(dialog).getByRole("button", { name: "נובמבר, עוד לא הגיע" })).toBeDisabled();
    await expect(within(dialog).getByRole("button", { name: "שנה הבאה" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(within(dialog).getByRole("button", { name: "יוני, תחזית" }));
    await waitFor(() => expect(doc.queryByRole("dialog", { name: "בחירת חודש" })).toBeNull());
    await waitFor(() => expect(within(canvasElement).getByText("תזרים צפוי · יוני")).toBeInTheDocument());
  },
};

/** FLOW-1052 (V3-Home): the month drawer open on the current month: the year, the forecast's box, the grid, סגירה. */
export const HomeDrawer: Story = {
  name: "Home, the month drawer",
  render: () => <CashHomeStory forecast={1_250_000n} example={false} initialDrawerOpen />,
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "בחירת חודש" });
    await expect(within(dialog).getByText("תזרים צפוי לסוף " + (HEBREW_MONTHS[Number(israelToday().slice(5, 7)) - 1] ?? ""))).toBeInTheDocument();
    await expect(within(dialog).getByRole("button", { name: "סגירה" })).toBeInTheDocument();
  },
};

/** FLOW-1015: a returning owner (one with recurring rows) sees the קבועים tip once, the count's sentence while a bill is late. Live Home has the company on the band, so the bubble opens over it. */
export const HomeRecurringTip: Story = { render: () => <CashHomeStory recurringTip /> };

/** FLOW-1017: three recurring bills late: their count on the band's קבועים icon, their card, and כל הקבועים at the activity's foot. */
export const HomeLateRecurring: Story = {
  render: () => <CashHomeStory late={3} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect((await canvas.findByRole("link", { name: "קבועים, 3 לא הגיעו" })).querySelector(".ui-band-count")?.textContent).toBe("3");
    await expect(canvas.getByRole("link", { name: "כל הקבועים" })).toHaveAttribute("href", "/recurring");
  },
};

/** The story's signal that the forecast's read answered (true) or is on its way again (false). */
const FORECAST_EVENT = "story-forecast";

/** The forecast row while its read is on its way, and once it answers on FORECAST_EVENT. Invented figure. */
function ForecastArrivesStory() {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const on = (event: Event) => {
      setArrived(event instanceof CustomEvent && event.detail === true);
    };
    window.addEventListener(FORECAST_EVENT, on);
    return () => {
      window.removeEventListener(FORECAST_EVENT, on);
    };
  }, []);
  return <CashHomeStory forecast={arrived ? 1_250_000n : null} forecastPending={!arrived} />;
}

/**
 * FLOW-1031: Home reads the forecast after it paints (FLOW-1019), so until the read answers the forecast row
 * keeps its place, a bar for its figure. The attention cards sit where they will stay when the figure lands.
 */
export const HomeForecastPending: Story = {
  name: "Home, forecast row kept while it loads",
  render: () => <ForecastArrivesStory />,
  play: async ({ canvasElement }) => {
    // The layout's own offsets: the page's enter motion moves the box for a moment, the layout does not.
    const attentionTop = () => {
      const box = canvasElement.querySelector(".ui-attn");
      if (!(box instanceof HTMLElement)) throw new Error("the attention box is not drawn");
      let top = 0;
      for (let node: Element | null = box; node instanceof HTMLElement; node = node.offsetParent) top += node.offsetTop;
      return top;
    };
    await waitFor(async () => {
      await expect(canvasElement.querySelector(".ui-skel-forecast-value")).not.toBeNull();
    });
    // Measured once the type has loaded: a font swap moves the page on its own.
    await document.fonts.ready;
    const before = attentionTop();
    window.dispatchEvent(new CustomEvent(FORECAST_EVENT, { detail: true }));
    const canvas = within(canvasElement);
    await canvas.findByRole("link", { name: "תזרים צפוי לסוף החודש" });
    await expect(attentionTop()).toBe(before);
    // Back to the read on its way, the state this story shows.
    window.dispatchEvent(new CustomEvent(FORECAST_EVENT, { detail: false }));
    await waitFor(async () => {
      await expect(canvasElement.querySelector(".ui-skel-forecast-value")).not.toBeNull();
    });
    await expect(attentionTop()).toBe(before);
  },
};

/** FLOW-958: offline, the last figures stay, and a line in the band says when they were read. */
export const HomeOffline: Story = { render: () => <CashHomeStory offlineSince={Date.UTC(2026, 9, 26, 7, 41)} /> };

/** FLOW-958: the read failed on the server: the band says so, with נסו שוב and צריך עזרה?. */
export const HomeFailed: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error-server" tabs>
      <HomeScreen />
    </StoryRoute>
  ),
};

/** FLOW-958: the read failed with no network: the band says so in the network's words. */
export const HomeFailedOffline: Story = {
  render: () => (
    <StoryRoute entry="/?preview=error" tabs>
      <HomeScreen />
    </StoryRoute>
  ),
};

/**
 * A past month: the darker band, "חזרה ל…", no forecast or cards. FLOW-1056 (owner): its activity as the current
 * month's: "הפעילות ב…" with the month's totals, its lines as קבועים and חד-פעמי, and the row to all its lines.
 */
export const HomePast: Story = {
  render: () => <CashHomeStory monthBack={1} attention={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = HEBREW_MONTHS[Number(shiftMonthKey(israelToday().slice(0, 7), -1).slice(5, 7)) - 1] ?? "";
    await expect(canvas.getByRole("heading", { name: `הפעילות ב${name}` })).toBeInTheDocument();
    await expect(canvasElement.querySelector(".ui-home-act-close")?.textContent).toMatch(/^נכנס .+ · יצא .+$/u);
    await expect(canvas.getByRole("heading", { name: "קבועים" })).toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "חד-פעמי" })).toBeInTheDocument();
    await expect(canvas.queryByRole("radio", { name: "נותר לשלם" })).toBeNull();
    await userEvent.click(canvas.getByRole("radio", { name: "חד-פעמי" }));
    await waitFor(() => expect(canvas.queryByRole("heading", { name: "קבועים" })).toBeNull());
    await expect(canvas.getByRole("link", { name: `כל התנועות ב${name}` })).toBeInTheDocument();
  },
};

/** FLOW-1056: a past month while its lines are read: the band, then skeleton rows. */
export const HomePastLoading: Story = {
  name: "Home past, loading",
  render: () => <CashHomeStory monthBack={1} attention={false} pastActivity={samplePastActivity(shiftMonthKey(israelToday().slice(0, 7), -1), { lines: null })} />,
};

/** FLOW-1056: a past month's lines did not load: the band stays, the list says so with a retry. */
export const HomePastFailed: Story = {
  name: "Home past, failed",
  render: () => <CashHomeStory monthBack={1} attention={false} pastActivity={samplePastActivity(shiftMonthKey(israelToday().slice(0, 7), -1), { lines: null, linesFailed: true })} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("רשימת התנועות לא נטענה")).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
  },
};

/** FLOW-1056: a past month with no lines: the list says so in words. */
export const HomePastEmpty: Story = {
  name: "Home past, no lines",
  render: () => <CashHomeStory monthBack={1} attention={false} pastActivity={samplePastActivity(shiftMonthKey(israelToday().slice(0, 7), -1), { lines: [], past: { more: false } })} />,
  play: async ({ canvasElement }) => {
    const name = HEBREW_MONTHS[Number(shiftMonthKey(israelToday().slice(0, 7), -1).slice(5, 7)) - 1] ?? "";
    await expect(within(canvasElement).getByText(`אין תנועות ב${name}`)).toBeInTheDocument();
  },
};

/** Scrolled past the band: the compact bar pins the month and the arrows, and the band's figures fade away (FLOW-364). */
export const HomeScrolled: Story = {
  render: () => <CashHomeStory />,
  play: async ({ canvasElement }) => {
    window.scrollTo(0, 400);
    const bar = await waitFor(() => canvasElement.ownerDocument.querySelector<HTMLElement>(".ui-compact-bar-band"));
    if (bar == null) throw new Error("the compact bar is not drawn");
    await expect(bar).toBeInTheDocument();
    // FLOW-374: the figure is whole inside the bar (the bar is 64px, the net sits in its centre).
    const net = bar.querySelector(".ui-compact-bar-centre-net");
    if (net == null) throw new Error("the bar's figure is not drawn");
    const barBox = bar.getBoundingClientRect();
    const netBox = net.getBoundingClientRect();
    await expect(netBox.bottom).toBeLessThanOrEqual(barBox.bottom);
    await expect(netBox.top).toBeGreaterThanOrEqual(barBox.top);
    window.scrollTo(0, 0);
  },
};
