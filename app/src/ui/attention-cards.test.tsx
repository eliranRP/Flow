import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionCards, HIDE_UNDO_MS } from "./attention-cards";
import type { BannerRow } from "./banner";
import { expectRtl, expectTarget } from "./test-support";
import { ToastProvider } from "./toast";

const ROWS: BannerRow[] = [
  { id: "changes", to: "/recurring/changes", title: "4 חיובים קבועים השתנו", dismissKey: "changes:4" },
  { id: "review", to: "/review", title: "3 תנועות לסקירה", button: { label: "לסקירה", hint: "3 תנועות" } },
  { id: "unpaid", to: "/unpaid", title: "3 חשבוניות פתוחות", dismissKey: "unpaid:3:2130000" },
];

function cards(rows: readonly BannerRow[] = ROWS) {
  return (
    <MemoryRouter>
      <AttentionCards rows={rows} storageKey="home" />
    </MemoryRouter>
  );
}

/** Clicks a row's X and lets its fold end. */
function dismiss(title: string) {
  fireEvent.click(screen.getByRole("button", { name: `הסתרה: ${title}` }));
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

describe("AttentionCards (FLOW-1043)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("puts the review row first with no X, and gives every other card a 44px X named after it", () => {
    expectRtl();
    const { container } = render(cards());
    expect(screen.getByRole("heading", { level: 2, name: "דורש טיפול" })).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["3 תנועות לסקירה", "4 חיובים קבועים השתנו", "3 חשבוניות פתוחות"]);
    expect(links[0]).toHaveAttribute("href", "/review");
    expect(screen.queryByRole("button", { name: "הסתרה: 3 תנועות לסקירה" })).toBeNull();
    const x = screen.getByRole("button", { name: "הסתרה: 4 חיובים קבועים השתנו" });
    expectTarget(x);
    expect(container.querySelector("section")).toHaveAttribute("aria-live", "polite");
  });

  it("folds a card on its X, keeps it hidden, and restores it from the head", () => {
    render(cards());
    fireEvent.click(screen.getByRole("button", { name: "הסתרה: 4 חיובים קבועים השתנו" }));
    // The card slides and folds before it leaves the list.
    expect(screen.getByText("4 חיובים קבועים השתנו").closest("li")).toHaveAttribute("data-leaving");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByText("4 חיובים קבועים השתנו")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("flow.attention.home") ?? "{}")).toEqual({ changes: "changes:4" });
    fireEvent.click(screen.getByRole("button", { name: "1 הוסתרו · הצגה" }));
    expect(screen.getByText("4 חיובים קבועים השתנו")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "1 הוסתרו · הצגה" })).toBeNull();
    expect(window.localStorage.getItem("flow.attention.home")).toBeNull();
  });

  it("shows a hidden row again once what it counts changes", () => {
    window.localStorage.setItem("flow.attention.home", JSON.stringify({ changes: "changes:4" }));
    const { rerender } = render(cards());
    expect(screen.queryByText("4 חיובים קבועים השתנו")).toBeNull();
    expect(screen.getByRole("button", { name: "1 הוסתרו · הצגה" })).toBeInTheDocument();
    const next = ROWS.map((row) => (row.id === "changes" ? { ...row, title: "5 חיובים קבועים השתנו", dismissKey: "changes:5" } : row));
    rerender(cards(next));
    expect(screen.getByText("5 חיובים קבועים השתנו")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הוסתרו/ })).toBeNull();
  });

  it("folds the section to one line when every card is hidden, and ביטול brings them back", () => {
    const rows = ROWS.filter((row) => row.button == null);
    render(cards(rows));
    dismiss("4 חיובים קבועים השתנו");
    dismiss("3 חשבוניות פתוחות");
    expect(screen.queryByRole("heading", { name: "דורש טיפול" })).toBeNull();
    expect(screen.getByText("אין מה לטפל · הכול נסקר")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByText("אין מה לטפל · הכול נסקר")).toBeNull();
  });

  it("hides for the session when storage throws", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);
    render(cards());
    dismiss("3 חשבוניות פתוחות");
    expect(screen.queryByText("3 חשבוניות פתוחות")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 הוסתרו · הצגה" }));
    expect(screen.getByText("3 חשבוניות פתוחות")).toBeInTheDocument();
  });

  it("draws nothing with no rows", () => {
    const { container } = render(cards([]));
    expect(container).toBeEmptyDOMElement();
  });

  it("FLOW-1097: draws a short title and tag beside the title, keeping the full title as the link's name", () => {
    const { container } = render(cards([
      { id: "unpaid", to: "/unpaid", title: "3 חשבוניות פתוחות · $21,300", short: "לגבייה", tag: "$21,300", dismissKey: "unpaid:3" },
      { id: "gym", to: "/recurring", title: "חדר כושר לא חויב", dismissKey: "late:gym" },
    ]));
    const [unpaid, gym] = screen.getAllByRole("link");
    expect(unpaid).toHaveAccessibleName("3 חשבוניות פתוחות · $21,300");
    expect(unpaid).toHaveClass("ui-attn-link-short");
    const shortSet = container.querySelector(".ui-attn-short");
    expect(shortSet).toHaveAttribute("aria-hidden", "true");
    expect([...(shortSet?.children ?? [])].map((part) => part.getAttribute("data-text"))).toEqual(["לגבייה", "$21,300"]);
    // The words are in the page once: the title.
    expect(screen.getAllByText(/חשבוניות פתוחות/)).toHaveLength(1);
    // A row without both keeps only its title, cut at its end under 360px.
    expect(gym).not.toHaveClass("ui-attn-link-short");
    expect(gym).not.toHaveAttribute("aria-label");
  });
});

describe("AttentionCards' הוסתר toast (FLOW-1094)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  function withToasts() {
    return render(
      <ToastProvider>
        <MemoryRouter>
          <AttentionCards rows={ROWS} storageKey="home" />
        </MemoryRouter>
      </ToastProvider>,
    );
  }

  it("says הוסתר for 4s with ביטול, which brings back only that card; the head's link stays for the other", () => {
    expect(HIDE_UNDO_MS).toBe(4000);
    withToasts();
    dismiss("4 חיובים קבועים השתנו");
    expect(screen.getByRole("status")).toHaveTextContent("הוסתר");
    dismiss("3 חשבוניות פתוחות");
    expect(screen.getByRole("button", { name: "2 הוסתרו · הצגה" })).toBeInTheDocument();
    // The second X's toast replaced the first: its ביטול brings back the invoices card, not the charges card.
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(screen.getByRole("link", { name: "3 חשבוניות פתוחות" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "4 חיובים קבועים השתנו" })).toBeNull();
    expect(screen.getByRole("button", { name: "1 הוסתרו · הצגה" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("flow.attention.home") ?? "null")).toEqual({ changes: "changes:4" });
  });

  it("stops a card's fold when ביטול comes before it ends", () => {
    withToasts();
    fireEvent.click(screen.getByRole("button", { name: "הסתרה: 4 חיובים קבועים השתנו" }));
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.getByText("4 חיובים קבועים השתנו").closest("li")).not.toHaveAttribute("data-leaving");
    expect(screen.queryByRole("button", { name: /הוסתרו · הצגה/u })).toBeNull();
    expect(JSON.parse(window.localStorage.getItem("flow.attention.home") ?? "null")).toEqual({});
  });
});
