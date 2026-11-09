import type { Meta, StoryObj } from "@storybook/react-vite";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { expect, within } from "storybook/test";
import { ColdOpenSkeleton, FullScreenFallback } from "./cold-open";
import { FormSkeleton } from "./ui/loading-shapes";
import { OFFLINE_WAIT_WORDS } from "./ui/offline-wait";
import { ScreenState } from "./ui/screen-state";
import { StoryRoute } from "./ui/story-route";

/**
 * FLOW-1140: what a signed-in route draws while the session loads (a cold open) and while a full-screen
 * route's code loads, and a loading place offline. The bar or band is on the first frame; the blocks
 * show after 300ms, as in the app.
 */
const meta = {
  title: "Screens/Loading frames",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function coldOpen(path: string, heading?: string): Story {
  return {
    render: () => (
      <StoryRoute entry={path}>
        <ColdOpenSkeleton />
      </StoryRoute>
    ),
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      if (heading != null) await expect(canvas.getByRole("heading", { name: heading })).toBeVisible();
      await expect(await canvas.findByText("טוען…", {}, { timeout: 2000 })).toBeInTheDocument();
    },
  };
}

/** Home keeps its own skeleton (FLOW-364), now with the tab bar it lands under. */
export const ColdOpenHome = coldOpen("/");
/** The Projects tab: its band and title, then the project cards. */
export const ColdOpenProjects = coldOpen("/projects", "פרויקטים");
/** The Loans tab: its band and title, then the summary card and rows. */
export const ColdOpenLoans = coldOpen("/loans", "הלוואות");
/** Settings: its title, then the grouped rows (its subpages draw Back's place over the same rows). */
export const ColdOpenSettings = coldOpen("/settings", "הגדרות");
/** קבועים: its own skeleton, title included. */
export const ColdOpenRecurring = coldOpen("/recurring");
/** The profit view: Back's place, the figure, the card and the rows. */
export const ColdOpenProfit = coldOpen("/profit");
/** A month's lines (and חשבוניות פתוחות, העברות לבדיקה): the figure, chips and grouped rows. */
export const ColdOpenMonthLines = coldOpen("/cash/2026-11/in/ILS");
/** A transaction, a loan or an invoice: Back's place and the detail page's blocks. */
export const ColdOpenDetail = coldOpen("/transactions/sample-1");
/** Any other tab page (here the review queue): Back's place, its title where it is fixed, and rows. */
export const ColdOpenReview = coldOpen("/review", "לאישור");
/** A full-screen form (the journal composer, the line split, setup): no tab bar, the form's blocks. */
export const ColdOpenJournal = coldOpen("/transactions/sample-1/journal", "פקודת יומן");
/** A full-screen list (search, install): no tab bar, Back's place and rows. */
export const ColdOpenSearch = coldOpen("/search");

/**
 * A full-screen route opened from a tab while its code loads (FullScreen's Suspense fallback): nothing for
 * 300ms, then the screen's bar and blocks. A neutral bar where the title is not known.
 */
export const FullScreenCodeLoading: Story = {
  render: () => (
    <MemoryRouter initialEntries={["/transactions/sample-1/split-category"]}>
      <div className="safe-bottom min-h-dvh">
        <FullScreenFallback />
      </div>
    </MemoryRouter>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("heading")).toBeNull();
    await expect(await canvas.findByRole("heading", { name: "פיצול" }, { timeout: 2000 })).toBeVisible();
    await expect(canvas.queryByRole("navigation")).toBeNull();
  },
};

/** The journal composer's loading place, as the bank name's read leaves it: online, or offline with the read paused. */
function ComposerWaiting({ offline }: { offline: boolean }) {
  const [client] = useState(() => {
    const next = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    onlineManager.setOnline(!offline);
    next.query({ queryKey: ["story-bank-name"], queryFn: () => new Promise<string>(() => undefined) }).catch(() => undefined);
    return next;
  });
  useEffect(() => () => {
    onlineManager.setOnline(true);
    client.clear();
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScreenState title="פקודת יומן" backTo="/" phase={{ kind: "loading" }} onRetry={() => undefined} loading={<FormSkeleton figure fields={3} />} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Offline, a read that waits for the connection: the offline line in place of the skeleton, under the screen's bar. */
export const OfflinePausedRead: Story = {
  render: () => <ComposerWaiting offline />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "פקודת יומן" })).toBeVisible();
    await expect(canvas.getByText(`אין חיבור · ${OFFLINE_WAIT_WORDS}`)).toBeVisible();
  },
};

/** The same read online: the skeleton stays a skeleton. */
export const OnlineKeepsSkeleton: Story = {
  render: () => <ComposerWaiting offline={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("טוען…", {}, { timeout: 2000 })).toBeInTheDocument();
    await expect(canvas.queryByText(OFFLINE_WAIT_WORDS, { exact: false })).toBeNull();
  },
  tags: ["clip-no-text"],
};
