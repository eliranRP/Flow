import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SAMPLE_JEV_BOOKINGS } from "../dev/journal-composer-sample";
import { jevBookingFailure, parseJevBookings, type JevBooking, type JevBookingApi } from "../jev-bookings";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { JEV_BOOKING_DELETE_HINT, JEV_BOOKING_HINT, JevBookingReview } from "./jev-booking-review";
import { ReviewAllList } from "./review-screen";

/** FLOW-955 (board LedgerReviewCard). Jev's bookings in לאישור: אישור, ביטול, and what a refusal says. Invented data. */
function renderReview(api: JevBookingApi, bookings: readonly JevBooking[] = SAMPLE_JEV_BOOKINGS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/review"]}>
            <JevBookingReview bookings={bookings} queued={2} next={null} search="" api={api} sample />
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Jev's booking in לאישור", () => {
  it("shows the proposed entry, the counter over every card, the next booking and the hint", () => {
    renderReview({ approve: vi.fn(), undo: vi.fn() });
    expect(screen.getByText("בדיקת פקודת יומן של Jev", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "הפקודה שהוצעה" })).toBeInTheDocument();
    expect(screen.getByText(/פריט/).textContent).toBe("פריט 1 מתוך 4");
    expect(screen.getByText(/הבא בתור: Example Mortgage/)).toBeInTheDocument();
    expect(screen.getByText(JEV_BOOKING_HINT)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "עריכה" })).toHaveAttribute("href", "/transactions/t-loan/journal?from=review");
  });

  it("אישור keeps the booking", async () => {
    const approve = vi.fn(() => Promise.resolve());
    renderReview({ approve, undo: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => { expect(approve).toHaveBeenCalledWith("t-loan"); });
    expect(await screen.findByText("הפקודה של Jev אושרה")).toBeInTheDocument();
  });

  it("ביטול takes it back", async () => {
    const undo = vi.fn(() => Promise.resolve());
    renderReview({ approve: vi.fn(), undo });
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(undo).toHaveBeenCalledWith("t-loan"); });
    expect(await screen.findByText("הפקודה של Jev בוטלה. התנועה חזרה לשיוך רגיל.")).toBeInTheDocument();
  });

  it("a booking that made the line says ביטול deletes it, and its toast says so", async () => {
    const created = SAMPLE_JEV_BOOKINGS.map((booking): JevBooking => ({ ...booking, kind: "book_line" }));
    const undo = vi.fn(() => Promise.resolve());
    renderReview({ approve: vi.fn(), undo }, created);
    expect(screen.getByText(JEV_BOOKING_DELETE_HINT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("הפקודה של Jev בוטלה והתנועה נמחקה.")).toBeInTheDocument();
  });

  it("the date reads dd/mm, as on the board", () => {
    renderReview({ approve: vi.fn(), undo: vi.fn() });
    expect(screen.getByText("16/10 · נכנס · שורת בנק")).toBeInTheDocument();
  });

  it("הצגת הכול lists Jev's bookings first, in the count", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/review/all"]}>
          <ReviewAllList rows={[]} bookings={SAMPLE_JEV_BOOKINGS} search="" backTo="/review" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(/2 פריטים מחכים/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Example Lending/ })).toHaveAttribute("href", "/review");
    expect(screen.getAllByText(/פקודת יומן של Jev/)).toHaveLength(2);
  });

  it("a line changed since, or a booking already handled, is final; a dropped connection retries", () => {
    expect(jevBookingFailure(new Error("line changed since"))).toMatchObject({ retry: false, tone: "info" });
    expect(jevBookingFailure(new Error("booking not found"))).toMatchObject({ message: "הפקודה כבר לא ממתינה לאישור.", retry: false });
    expect(jevBookingFailure(new Error("Failed to fetch"))).toMatchObject({ retry: true });
  });

  it("reads the server's list, with each entry's legs", () => {
    const [first] = parseJevBookings([{
      write_id: "w1", transaction_id: "t1", kind: "book_line", booked_at: "2026-10-20T10:00:00Z", party: "Example Co",
      doc_date: "2026-10-20", direction: "expense", amount_gross: -10000, currency: "USD", source: "manual",
      journal: { transaction_id: "t1", currency: "USD", balanced: true, booked_by_ai: true, legs: [] },
    }]);
    expect(first?.amount_gross).toBe(-10_000n);
    expect(first?.journal?.booked_by_ai).toBe(true);
  });
});
