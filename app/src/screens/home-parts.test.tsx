import { type CashCurrencyRow } from "@flow/shared";
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForecastRow, HomeBandActions, HomeFigures, homeMonthLabel, HomeMonthPill, type HomeFigureRows } from "./home-parts";
import { CashHomeSkeleton } from "./home-skeleton";
import { useReturningRecurringOwner } from "../recurring-tip";
import { renderWithProviders } from "../test-render";
import { SKELETON_DELAY_MS } from "../ui/skeleton";
import { expectRtl } from "../ui/test-support";

// --- home-parts.test.tsx

// Invented figures only; amounts are agorot.
function row(net: number, profit: number): CashCurrencyRow {
  return {
    currency: "ILS",
    in_minor: 1_000_000n,
    out_minor: 1_000_000n - BigInt(net),
    net_minor: BigInt(net),
    profit_minor: BigInt(profit),
    excluded_count: 0,
    excluded_in_minor: 0n,
    excluded_out_minor: 0n,
    not_in_profit_categories: [{ name: "שיפוץ והשבחה", amount_minor: BigInt(net - profit) }],
  };
}

const nav = { earlierKey: "2026-09", laterKey: null, onStep: vi.fn(), onOpenDrawer: vi.fn() };

describe("Home's band parts (FLOW-364)", () => {
  it("draws each figure row as label, amount, change chip, the amount beside the chip (FLOW-374)", () => {
    const figures: HomeFigureRows = {
      currency: "ILS",
      rows: [row(-200_000, 0)],
      compare: { in_minor: 900_000n, out_minor: 1_100_000n },
      previousName: "ספטמבר",
      day: 11,
      isPast: false,
    };
    const { container } = render(
      <MemoryRouter>
        <HomeFigures monthKey="2026-10" figures={figures} search="" animate={null} />
      </MemoryRouter>,
    );
    const rowLinks = container.querySelectorAll<HTMLElement>(".ui-band-rows .ui-band-row-link");
    expect(rowLinks).toHaveLength(2);
    for (const link of rowLinks) {
      const [label, amount, chip] = Array.from(link.children);
      expect(label?.className).toContain("ui-band-row-label");
      expect(amount?.className).toContain("ui-band-row-amount");
      expect(chip?.querySelector(".ui-change-amount")).not.toBeNull();
    }
  });

  it("names the month pill and disables the later arrow on the current month", () => {
    render(
      <MemoryRouter>
        <HomeMonthPill monthKey="2026-10" nav={nav} />
      </MemoryRouter>,
    );
    expect(screen.getByText(homeMonthLabel("2026-10"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "חודש הבא" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "חודש קודם" })).not.toHaveAttribute("aria-disabled");
  });

  it("names the forecast by the month's name", () => {
    render(<ForecastRow monthKey="2026-10" minor={-6_810_000n} currency="ILS" />);
    expect(screen.getByText("תזרים צפוי לסוף אוקטובר")).toBeInTheDocument();
  });
});
// --- home-skeleton.test.tsx

describe("the band's קבועים icon (FLOW-986, board concept B)", () => {
  it("sits after search and opens קבועים, with no count when nothing is late", () => {
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="?preview=1" />);
    const icon = screen.getByRole("link", { name: "קבועים" });
    expect(icon).toHaveAttribute("href", "/recurring?preview=1");
    expect(icon.querySelector(".ui-band-count")).toBeNull();
    const search = screen.getByRole("link", { name: "חיפוש" });
    expect(search.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows how many are late on the icon, not a bare dot, and says it in its name (FLOW-1017)", () => {
    const { unmount } = renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" lateRecurring={2} />);
    expect(screen.getByRole("link", { name: "קבועים, 2 לא הגיעו" }).querySelector(".ui-band-count")?.textContent).toBe("2");
    unmount();
    const again = renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" lateRecurring={1} />);
    expect(screen.getByRole("link", { name: "קבועים, אחד לא הגיע" }).querySelector(".ui-band-count")?.textContent).toBe("1");
    again.unmount();
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" lateRecurring={12} />);
    expect(screen.getByRole("link", { name: "קבועים, 12 לא הגיעו" }).querySelector(".ui-band-count")?.textContent).toBe("9+");
  });

  it("FLOW-1095: holds search and הגדרות וחשבון in a 44px ⋯ sheet, the band's row under 360px", async () => {
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="?preview=1" />);
    // Both stay on the row for 360px and up; 07-band-home.css swaps them for the ⋯ under 360px.
    expect(screen.getByRole("link", { name: "חיפוש" })).toHaveClass("ui-band-wide");
    expect(screen.getByRole("link", { name: "הגדרות וחשבון" })).toHaveClass("ui-band-wide");
    const more = screen.getByRole("button", { name: "עוד" });
    expect(more).toHaveClass("ui-band-more", "ui-icon-btn");
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(more);
    const sheet = await screen.findByRole("dialog", { name: "עוד" });
    expect(within(sheet).getByRole("button", { name: /חיפוש/u })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /הגדרות וחשבון/u })).toBeInTheDocument();
    // קבועים and + stay on the band.
    expect(within(sheet).queryByRole("button", { name: /קבועים/u })).toBeNull();
  });

  it("is not on a past month's band", () => {
    renderWithProviders(<HomeBandActions isPast currentName="אוקטובר" search="" lateRecurring={2} />);
    expect(screen.queryByRole("link", { name: /קבועים/ })).toBeNull();
  });

  it("gives a past month's way back the 44px hit area (FLOW-1084)", () => {
    renderWithProviders(<HomeBandActions isPast currentName="נובמבר" search="" />);
    expect(screen.getByRole("link", { name: /חזרה לנובמבר/ }).classList.contains("ui-hit")).toBe(true);
  });
});

describe("the one-time קבועים tip (FLOW-987)", () => {
  afterEach(() => {
    window.localStorage.removeItem("flow.recurring-tip-seen");
  });

  it("shows under the icon until its ✕, then never again on this phone", () => {
    const { unmount } = renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" lateRecurring={1} recurringTip />);
    const tip = screen.getByRole("status", { name: "קבועים עברו לכאן" });
    expect(tip).toHaveTextContent("המספר האדום: קבועים שלא הגיעו.");
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(screen.queryByRole("status", { name: "קבועים עברו לכאן" })).toBeNull();
    unmount();
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" recurringTip />);
    expect(screen.queryByRole("status", { name: "קבועים עברו לכאן" })).toBeNull();
  });

  it("says the count's sentence only while the count is on (FLOW-1015, FLOW-1017)", () => {
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" recurringTip />);
    const tip = screen.getByRole("status", { name: "קבועים עברו לכאן" });
    expect(tip).toHaveTextContent("קבועים עברו לכאן");
    expect(tip).not.toHaveTextContent("המספר האדום");
  });

  it("opens once the owner's recurring rows are known, not only at first draw (FLOW-1015)", () => {
    const { rerender } = renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" recurringTip={false} />);
    expect(screen.queryByRole("status", { name: "קבועים עברו לכאן" })).toBeNull();
    rerender(<HomeBandActions isPast={false} currentName="" search="" recurringTip />);
    expect(screen.getByRole("status", { name: "קבועים עברו לכאן" })).toBeInTheDocument();
  });

  it("closes on a press outside it, and the press still reaches the control under it (FLOW-1015)", () => {
    const pressed = vi.fn();
    renderWithProviders(
      <>
        <HomeBandActions isPast={false} currentName="" search="" recurringTip />
        <button type="button" onClick={pressed}>חודש קודם</button>
      </>,
    );
    const under = screen.getByRole("button", { name: "חודש קודם" });
    fireEvent.pointerDown(under);
    fireEvent.click(under);
    expect(screen.queryByRole("status", { name: "קבועים עברו לכאן" })).toBeNull();
    expect(pressed).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("flow.recurring-tip-seen")).toBe("1");
  });

  it("stays open on a press inside it, and closes on a scroll (FLOW-1015)", () => {
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" recurringTip />);
    const tip = screen.getByRole("status", { name: "קבועים עברו לכאן" });
    fireEvent.pointerDown(tip);
    expect(screen.getByRole("status", { name: "קבועים עברו לכאן" })).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole("status", { name: "קבועים עברו לכאן" })).toBeNull();
  });

  it("is seen once the icon is tapped", () => {
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" recurringTip />);
    fireEvent.click(screen.getByRole("link", { name: "קבועים" }));
    expect(window.localStorage.getItem("flow.recurring-tip-seen")).toBe("1");
  });

  it("is not shown where Home does not ask for it (previews, stories, a first-time owner)", () => {
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" />);
    expect(screen.queryByRole("status", { name: "קבועים עברו לכאן" })).toBeNull();
  });
});

describe("useReturningRecurringOwner (FLOW-1015)", () => {
  afterEach(() => {
    window.localStorage.removeItem("flow.recurring-tip-seen");
  });

  function Probe({ active }: { active: boolean }) {
    return <p>{useReturningRecurringOwner(active) ? "returning" : "new"}</p>;
  }

  it("is a returning owner with recurring rows; an owner with none is marked seen and never read again", async () => {
    const client = new QueryClient();
    client.setQueryData(["recurring-schedule"], [{ party_id: "x" }]);
    const { unmount } = renderWithProviders(<Probe active />, { client });
    expect(screen.getByText("returning")).toBeInTheDocument();
    unmount();
    const empty = new QueryClient();
    empty.setQueryData(["recurring-schedule"], []);
    renderWithProviders(<Probe active />, { client: empty });
    expect(screen.getByText("new")).toBeInTheDocument();
    await waitFor(() => { expect(window.localStorage.getItem("flow.recurring-tip-seen")).toBe("1"); });
  });

  it("reads nothing off live Home (previews): no schedule read starts", () => {
    const client = new QueryClient();
    renderWithProviders(<Probe active={false} />, { client });
    expect(screen.getByText("new")).toBeInTheDocument();
    expect(client.getQueryState(["recurring-schedule"])?.fetchStatus ?? "idle").toBe("idle");
  });

  it("starts the schedule read on live Home while the tip is unseen (the positive control)", () => {
    const client = new QueryClient();
    renderWithProviders(<Probe active />, { client });
    expect(client.getQueryState(["recurring-schedule"])?.fetchStatus).toBe("fetching");
  });
});

describe("CashHomeSkeleton (FLOW-364)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the band with its real month and icons, then the attention cards and the activity (FLOW-1036)", () => {
    expectRtl();
    renderWithProviders(<CashHomeSkeleton />);
    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    const band = document.querySelector(".ui-band");
    expect(band).not.toBeNull();
    expect(band?.querySelector(".ui-band-month-static")).not.toBeNull();
    expect(band?.querySelector(".ui-band-body .ui-skel-band-hero")).not.toBeNull();
    expect(band?.querySelectorAll(".ui-skel-band-row")).toHaveLength(2);
    expect(band?.querySelector('[aria-label="חיפוש"]')).not.toBeNull();
    expect(document.querySelectorAll(".ui-skel-attention .ui-skel-row")).toHaveLength(2);
    expect(document.querySelectorAll(".ui-skel-list .ui-skel-row")).toHaveLength(3);
    expect(screen.getByText("טוען…")).toBeInTheDocument();
    // No past-month list is loaded on Home any more (FLOW-364).
    expect(screen.queryByText("חודשים קודמים")).toBeNull();
  });

  it("shows nothing before the delay", () => {
    renderWithProviders(<CashHomeSkeleton />);
    expect(screen.queryByText("טוען…")).toBeNull();
    expect(document.querySelector(".ui-skel-attention")).toBeNull();
  });
});