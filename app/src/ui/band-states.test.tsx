import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BandLoadFailed, BandOfflineLine, israelHourMinute, ReviewButton } from "./band-states";

describe("band states (FLOW-958, FLOW-961)", () => {
  it("says offline which moment the figures are from, Israel time", () => {
    render(<BandOfflineLine since={Date.UTC(2026, 9, 26, 7, 41)} />);
    expect(screen.getByRole("status")).toHaveTextContent("אין חיבור · מוצג המצב מ־09:41");
    expect(israelHourMinute(Date.UTC(2026, 0, 5, 22, 5))).toBe("00:05");
  });

  it("keeps the band on a failed read, with the retry and the way to help", () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <MemoryRouter>
        <BandLoadFailed title="אוקטובר לא נטען" offline={false} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "אוקטובר לא נטען" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "צריך עזרה?" })).toHaveAttribute("href", "/help");
    rerender(
      <MemoryRouter>
        <BandLoadFailed title="אוקטובר לא נטען" offline onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "אין חיבור" })).toBeInTheDocument();
    expect(screen.getByText("אין חיבור לאינטרנט. שום דבר לא נמחק.")).toBeInTheDocument();
  });

  it("draws the review row as one filled button with its time, and nothing for a plain row", () => {
    const { container, rerender } = render(
      <MemoryRouter>
        <ReviewButton row={{ id: "review", title: "7 ממתינים", to: "/review", button: { label: "לאישור 7 פריטים", hint: "כ־2 דקות" } }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: /לאישור 7 פריטים/ })).toHaveAttribute("href", "/review");
    expect(screen.getByText("· כ־2 דקות")).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <ReviewButton row={{ id: "late", title: "חשבון אחד באיחור", to: "/missing-bills" }} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
