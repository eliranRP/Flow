import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OFFLINE_WAIT_WORDS } from "./offline-wait";
import { DelayedSkeleton, ListSkeleton, SKELETON_DELAY_MS, SkeletonSwap } from "./skeleton";

let client: QueryClient;
let resolveRead: (value: string) => void;

/** A read the way a screen sends one: it pauses while offline and runs once the connection is back. */
function startRead() {
  client.query({
    queryKey: ["read"],
    queryFn: () => new Promise<string>((resolve) => { resolveRead = resolve; }),
  }).catch(() => undefined);
}

function wrap(children: ReactNode) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => {
    onlineManager.setOnline(true);
  });
  client.clear();
  vi.useRealTimers();
});

describe("the skeletons' offline line (FLOW-1140)", () => {
  it("offline, a load waiting on a paused read shows the offline line in place of the skeleton", () => {
    onlineManager.setOnline(false);
    startRead();
    expect(client.getQueryCache().find({ queryKey: ["read"] })?.state.fetchStatus).toBe("paused");
    render(wrap(<SkeletonSwap loading><ListSkeleton /></SkeletonSwap>));
    expect(screen.getByRole("status")).toHaveTextContent(`אין חיבור · ${OFFLINE_WAIT_WORDS}`);
    expect(document.querySelector(".ui-skel-row")).toBeNull();
  });

  it("when the connection returns, the read resumes and the skeleton comes back until it lands", async () => {
    onlineManager.setOnline(false);
    startRead();
    render(wrap(<SkeletonSwap loading><ListSkeleton /></SkeletonSwap>));
    await act(async () => {
      onlineManager.setOnline(true);
      await Promise.resolve();
    });
    expect(client.getQueryCache().find({ queryKey: ["read"] })?.state.fetchStatus).toBe("fetching");
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(screen.queryByText(OFFLINE_WAIT_WORDS, { exact: false })).toBeNull();
    expect(document.querySelectorAll(".ui-skel-row")).toHaveLength(6);
    act(() => {
      resolveRead("in");
    });
  });

  it("online, nothing changes: the skeleton stays a skeleton", () => {
    startRead();
    render(wrap(<SkeletonSwap loading><ListSkeleton /></SkeletonSwap>));
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(screen.queryByText(OFFLINE_WAIT_WORDS, { exact: false })).toBeNull();
    expect(document.querySelectorAll(".ui-skel-row")).toHaveLength(6);
  });

  it("offline with no read waiting, the skeleton stays", () => {
    onlineManager.setOnline(false);
    render(wrap(<SkeletonSwap loading><ListSkeleton /></SkeletonSwap>));
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(screen.queryByText(OFFLINE_WAIT_WORDS, { exact: false })).toBeNull();
  });

  it("DelayedSkeleton swaps only where it marks a whole loading place", () => {
    onlineManager.setOnline(false);
    startRead();
    render(wrap(
      <>
        <DelayedSkeleton offline><ListSkeleton /></DelayedSkeleton>
        <div data-testid="block"><DelayedSkeleton><span className="ui-skeleton-bar" /></DelayedSkeleton></div>
      </>,
    ));
    expect(screen.getAllByText(OFFLINE_WAIT_WORDS, { exact: false })).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    expect(screen.getByTestId("block").querySelector(".ui-skeleton-bar")).not.toBeNull();
  });
});
