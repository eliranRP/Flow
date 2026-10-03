import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRefreshingNow } from "./israel-clock";
import { israelSyncPhrase, msUntilNextIsraelDay } from "./sumit-copy";

describe("useRefreshingNow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes a last-sync phrase at the next Israel midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T20:59:30.000Z"));
    function Probe() {
      const [now] = useRefreshingNow();
      return <p>{israelSyncPhrase("2026-10-03T18:00:00.000Z", now)}</p>;
    }
    render(<Probe />);
    expect(screen.getByText("עודכן ב-21:00")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(msUntilNextIsraelDay(Date.now()) + 50);
    });
    expect(screen.getByText("עודכן אתמול ב-21:00")).toBeInTheDocument();
  });
});
