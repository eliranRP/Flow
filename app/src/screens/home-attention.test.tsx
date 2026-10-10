import type { Dashboard, ProjectRow } from "@flow/shared";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { HomeBooks } from "./HomeScreen";
import { thisMonth } from "../period";

function project(id: string, profit: bigint): ProjectRow {
  return {
    id,
    name: `פרויקט ${id}`,
    status: "active",
    income_agorot: profit,
    direct_agorot: 0n,
    shared_agorot: 0n,
    profit_before_shared_agorot: profit,
    profit_agorot: profit,
    by_currency: [],
  };
}

function books(review: number, projects: ProjectRow[] = []): Dashboard {
  return {
    company_id: "co",
    name: "Flow Test",
    vat_registered: true,
    basis: "invoiced",
    from: "2026-09-01",
    to: "2026-09-28",
    income_agorot: 10_000_000n,
    direct_agorot: 4_000_000n,
    shared_agorot: 0n,
    overhead_agorot: 0n,
    expense_agorot: 4_000_000n,
    net_profit_agorot: 6_000_000n,
    prev_income_agorot: null,
    prev_expense_agorot: null,
    prev_net_agorot: null,
    active_projects: 0,
    review_count: review,
    projects,
    by_currency: [],
  };
}

function renderHome({
  review,
  unpaid,
  gross = 0n,
  phase = "ready",
  search = "",
  projects = [],
}: {
  projects?: ProjectRow[];
  review: number;
  unpaid: number;
  gross?: bigint;
  phase?: "loading" | "error" | "empty" | "ready";
  search?: string;
}) {
  return render(
    <MemoryRouter>
      <HomeBooks
        data={books(review, projects)}
        previewing={false}
        search={search}
        unpaidGross={gross}
        unpaidCount={unpaid}
        unpaidPhase={phase}
        period={thisMonth()}
        onPeriod={() => undefined}
      />
    </MemoryRouter>,
  );
}

const reviewLink = () => screen.queryByRole("link", { name: /ממתינ\S* לאישור/ });
const unpaidLink = () => screen.queryByRole("link", { name: /חשבוני(ת|ות) פתוח/ });

describe("Home attention card (FLOW-321)", () => {
  it("shows no card when nothing waits and nothing is unpaid", () => {
    renderHome({ review: 0, unpaid: 0 });
    expect(reviewLink()).toBeNull();
    expect(unpaidLink()).toBeNull();
    expect(document.querySelector(".ui-banner, .ui-banner-rows")).toBeNull();
  });

  it("shows two rows when both exist, so unpaid is one tap from Home", () => {
    renderHome({ review: 7, unpaid: 3, gross: 2_340_000n });
    const card = document.querySelector(".ui-banner-rows");
    expect(card).not.toBeNull();
    const rows = within(card as HTMLElement).getAllByRole("link");
    expect(rows).toHaveLength(2);
    const review = screen.getByRole("link", { name: "7 פריטים ממתינים לאישור" });
    const unpaid = screen.getByRole("link", { name: "3 חשבוניות פתוחות ₪23,400 · לגבייה" });
    expect(review).toHaveAttribute("href", "/review");
    expect(unpaid).toHaveAttribute("href", "/unpaid");
    expect(rows[0]).toBe(review);
    expect(rows[1]).toBe(unpaid);
    expect(review.querySelector('bdi[dir="ltr"]')).toHaveTextContent("7");
    expect(unpaid.querySelector('.ui-row-hint bdi[dir="ltr"]')).toHaveTextContent("₪23,400");
  });

  it("uses singular copy for one of each, with distinct names", () => {
    renderHome({ review: 1, unpaid: 1, gross: 468_000n });
    expect(screen.getByRole("link", { name: "פריט אחד ממתין לאישור" })).toHaveAttribute("href", "/review");
    expect(screen.getByRole("link", { name: "חשבונית פתוחה אחת ₪4,680 · לגבייה" })).toHaveAttribute("href", "/unpaid");
    expect(screen.queryByText(/פריטים/)).toBeNull();
    expect(screen.queryByText(/חשבוניות/)).toBeNull();
  });

  it("shows one review row when nothing is unpaid, singular and plural", () => {
    const { unmount } = renderHome({ review: 1, unpaid: 0 });
    expect(screen.getByRole("link", { name: "פריט אחד ממתין לאישור" })).toHaveClass("ui-banner");
    expect(unpaidLink()).toBeNull();
    expect(document.querySelector(".ui-banner-rows")).toBeNull();
    unmount();
    renderHome({ review: 12, unpaid: 0 });
    expect(screen.getByRole("link", { name: "12 פריטים ממתינים לאישור" })).toHaveAttribute("href", "/review");
    expect(unpaidLink()).toBeNull();
  });

  it("shows one unpaid row with its total when nothing waits, singular and plural", () => {
    const { unmount } = renderHome({ review: 0, unpaid: 1, gross: 100_000n });
    expect(screen.getByRole("link", { name: "חשבונית פתוחה אחת ₪1,000 · לגבייה" })).toHaveClass("ui-banner");
    expect(reviewLink()).toBeNull();
    unmount();
    renderHome({ review: 0, unpaid: 4, gross: 2_340_000n });
    expect(screen.getByRole("link", { name: "4 חשבוניות פתוחות ₪23,400 · לגבייה" })).toHaveAttribute("href", "/unpaid");
    expect(reviewLink()).toBeNull();
  });

  it("keeps the preview search on both rows", () => {
    renderHome({ review: 2, unpaid: 2, gross: 200_000n, search: "?preview=1" });
    expect(reviewLink()).toHaveAttribute("href", "/review?preview=1");
    expect(unpaidLink()).toHaveAttribute("href", "/unpaid?preview=1");
  });

  it("drops the unpaid row while unpaid is loading or failed", () => {
    for (const phase of ["loading", "error"] as const) {
      const { unmount } = renderHome({ review: 3, unpaid: 2, gross: 200_000n, phase });
      expect(screen.getByRole("link", { name: "3 פריטים ממתינים לאישור" })).toBeInTheDocument();
      expect(unpaidLink()).toBeNull();
      unmount();
    }
  });

  it("sits under the first two projects, so a project shows on a 667px screen (FLOW-355)", () => {
    renderHome({ review: 2, unpaid: 0, projects: [project("א", 3_000n), project("ב", 2_000n), project("ג", 1_000n)] });
    const card = document.querySelector(".ui-banner, .ui-banner-rows");
    const lists = document.querySelectorAll(".ui-project-list");
    expect(lists).toHaveLength(2);
    expect(within(lists[0] as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
    expect(within(lists[1] as HTMLElement).getAllByRole("listitem")).toHaveLength(1);
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(lists[0] as Element, card as Element)).toBe(true);
    expect(follows(card as Element, lists[1] as Element)).toBe(true);
  });

  it("follows the list when there are two projects or fewer (FLOW-355)", () => {
    renderHome({ review: 2, unpaid: 0, projects: [project("א", 3_000n)] });
    const lists = document.querySelectorAll(".ui-project-list");
    expect(lists).toHaveLength(1);
    expect(Boolean((lists[0] as Element).compareDocumentPosition(document.querySelector(".ui-banner, .ui-banner-rows") as Element) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
