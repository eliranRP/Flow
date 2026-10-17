// vitest-css: these queries rely on the app's CSS hiding elements.
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cashMonthKey } from "../cash";
import { sampleCashMonths } from "../dev/cash-sample";
import { renderWithProviders } from "../test-render";
import { attentionRows, CashHome } from "./HomeScreen";

/** The live Home's rows: the unpaid figures count only while unpaid is ready (HomeScreen). */
function renderHome({
  review,
  unpaid,
  gross = 0n,
  phase = "ready",
  search = "",
}: {
  review: number;
  unpaid: number;
  gross?: bigint;
  phase?: "loading" | "error" | "empty" | "ready";
  search?: string;
}) {
  const data = sampleCashMonths();
  const currentKey = cashMonthKey(data.months[0]?.month ?? "");
  const ready = phase === "ready";
  return renderWithProviders(
    <CashHome
      data={data}
      monthKey={currentKey}
      currentKey={currentKey}
      previewing={false}
      search={search}
      attention={attentionRows({
        pending: review,
        unpaidCount: ready ? unpaid : 0,
        unpaidGross: ready ? gross : 0n,
        search,
      })}
      onStepMonth={() => undefined}
    />,
    { route: `/${search}` },
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
});
