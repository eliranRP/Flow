import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleReview } from "../ui/screen-stories-support";
import { renderWithProviders } from "../test-render";
import { ReviewQueue } from "./flow-screens";

/** FLOW-960 / decision 0212: לאישור's toasts hang under the header; the undo stays 5s, a failed approve stays. */

const row = { ...sampleReview, auto_approved_today: 0 };

function renderQueue(run: () => Promise<void>) {
  const view = renderWithProviders(
    <ReviewQueue rows={[row]} search="" sample previewWrite={{ run, onDone: () => undefined, onUndo: () => undefined }} />,
    { route: "/review" },
  );
  return view;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Review toasts (FLOW-960)", () => {
  it("hangs the approve undo under the header and keeps it 5s", async () => {
    renderQueue(() => Promise.resolve());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    expect(await screen.findByText("הפריט אושר")).toBeInTheDocument();
    expect(document.querySelector(".ui-toast-host")).toHaveAttribute("data-place", "top");
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByText("הפריט אושר")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    await waitFor(() => {
      expect(screen.queryByText("הפריט אושר")).not.toBeInTheDocument();
    });
  });

  it("keeps a failed approve's toast until it is acted on, and ends it when the queue is left", async () => {
    const view = renderQueue(() => Promise.reject(new Error("Failed to fetch")));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(await screen.findByRole("button", { name: "אישור" }));
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(retry).toBeInTheDocument();
    expect(document.querySelector(".ui-toast-host")).toHaveAttribute("data-place", "top");
    view.rerender(<p>בית</p>);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
    });
  });
});
