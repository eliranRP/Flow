import { type CashCurrencyRow } from "@flow/shared";
import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionBox, ForecastRow, HomeBandActions, HomeFigures, homeMonthLabel, HomeMonthPill, SplitCard, splitTakeaway, type HomeFigureRows } from "./home-parts";
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

  it("titles the split card with its takeaway, the metric's name above it (FLOW-958)", () => {
    const { rerender } = render(
      <MemoryRouter>
        <SplitCard monthKey="2026-10" row={row(-94_600, 12_000)} search="" onOpenProfit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("region", { name: "רוב המינוס הלך לנכסים" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "רוב המינוס הלך לנכסים" })).toBeInTheDocument();
    expect(screen.getByText("ממה מורכב המינוס")).toBeInTheDocument();
    // The note under the rows said the title again; it is gone.
    expect(screen.queryByText(/הפעילות השוטפת הרוויחה/)).toBeNull();
    rerender(
      <MemoryRouter>
        <SplitCard monthKey="2026-10" row={row(50_000, 80_000)} search="" onOpenProfit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByText("ממה מורכב התזרים")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "רוב התזרים הוא רווח" })).toBeInTheDocument();
  });

  it("words the takeaway by the part that leads", () => {
    expect(splitTakeaway("out", -1n, 1n)).toBe("רוב המינוס הלך לנכסים");
    expect(splitTakeaway("out", 1n, 1n)).toBe("רוב מה שיצא הלך לנכסים");
    expect(splitTakeaway("in", 1n, 1n)).toBe("רוב מה שנכנס הוא הון");
    expect(splitTakeaway(null, -1n, -1n)).toBe("רוב המינוס הוא הפסד שוטף");
    expect(splitTakeaway(null, 1n, -1n)).toBe("הפעילות השוטפת הפסידה");
    expect(splitTakeaway(null, 1n, 1n)).toBe("רוב התזרים הוא רווח");
  });

  it("hides the split card when both parts are 0", () => {
    const { container } = render(
      <MemoryRouter>
        <SplitCard monthKey="2026-10" row={row(0, 0)} search="" onOpenProfit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hides the attention box with no rows", () => {
    const { container } = render(<AttentionBox rows={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names the forecast by the month's name", () => {
    render(<ForecastRow monthKey="2026-10" minor={-6_810_000n} currency="ILS" />);
    expect(screen.getByText("תזרים צפוי לסוף אוקטובר")).toBeInTheDocument();
  });
});
// --- home-skeleton.test.tsx

describe("the band's קבועים icon (FLOW-986, board concept B)", () => {
  it("sits after search and opens קבועים, with no dot when nothing is late", () => {
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="?preview=1" />);
    const icon = screen.getByRole("link", { name: "קבועים" });
    expect(icon).toHaveAttribute("href", "/recurring?preview=1");
    expect(icon.querySelector(".ui-band-dot")).toBeNull();
    const search = screen.getByRole("link", { name: "חיפוש" });
    expect(search.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks late bills with a dot and says how many in its name", () => {
    const { unmount } = renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" lateRecurring={2} />);
    expect(screen.getByRole("link", { name: "קבועים, 2 לא הגיעו" }).querySelector(".ui-band-dot")).not.toBeNull();
    unmount();
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" lateRecurring={1} />);
    expect(screen.getByRole("link", { name: "קבועים, אחד לא הגיע" })).toBeInTheDocument();
  });

  it("is not on a past month's band", () => {
    renderWithProviders(<HomeBandActions isPast currentName="אוקטובר" search="" lateRecurring={2} />);
    expect(screen.queryByRole("link", { name: /קבועים/ })).toBeNull();
  });
});

describe("the one-time קבועים tip (FLOW-987)", () => {
  afterEach(() => {
    window.localStorage.removeItem("flow.recurring-tip-seen");
  });

  it("shows under the icon until its ✕, then never again on this phone", () => {
    const { unmount } = renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" lateRecurring={1} recurringTip />);
    const tip = screen.getByRole("status", { name: "קבועים עברו לכאן" });
    expect(tip).toHaveTextContent("נקודה אדומה: חשבון קבוע לא הגיע.");
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(screen.queryByRole("status", { name: "קבועים עברו לכאן" })).toBeNull();
    unmount();
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" recurringTip />);
    expect(screen.queryByRole("status", { name: "קבועים עברו לכאן" })).toBeNull();
  });

  it("says the dot's sentence only while the dot is on (FLOW-1015)", () => {
    renderWithProviders(<HomeBandActions isPast={false} currentName="" search="" recurringTip />);
    const tip = screen.getByRole("status", { name: "קבועים עברו לכאן" });
    expect(tip).toHaveTextContent("קבועים עברו לכאן");
    expect(tip).not.toHaveTextContent("נקודה אדומה");
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

  it("draws the band with its real month and icons, then the split card and the box", () => {
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
    expect(document.querySelector(".ui-home-split")).not.toBeNull();
    expect(document.querySelectorAll(".ui-home-attention .ui-skel-row")).toHaveLength(2);
    expect(document.querySelectorAll(".ui-skel-list .ui-skel-row")).toHaveLength(3);
    expect(screen.getByText("טוען…")).toBeInTheDocument();
    // No past-month list is loaded on Home any more (FLOW-364).
    expect(screen.queryByText("חודשים קודמים")).toBeNull();
  });

  it("shows nothing before the delay", () => {
    renderWithProviders(<CashHomeSkeleton />);
    expect(screen.queryByText("טוען…")).toBeNull();
    expect(document.querySelector(".ui-home-split")).toBeNull();
  });
});