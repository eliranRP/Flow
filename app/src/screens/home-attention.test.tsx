// vitest-css: these queries rely on the app's CSS hiding elements.
import { screen } from "@testing-library/react";
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
  syncing = null,
}: {
  review: number;
  unpaid: number;
  gross?: bigint;
  phase?: "loading" | "error" | "empty" | "ready";
  search?: string;
  syncing?: string | null;
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
      syncing={syncing}
      onStepMonth={() => undefined}
    />,
    { route: `/${search}` },
  );
}

const reviewLink = () => screen.queryByRole("link", { name: /^לאישור/ });
const unpaidLink = () => screen.queryByRole("link", { name: /חשבוני(ת|ות) פתוח/ });

describe("Home attention card (FLOW-321)", () => {
  it("shows no card when nothing waits and nothing is unpaid", () => {
    renderHome({ review: 0, unpaid: 0 });
    expect(reviewLink()).toBeNull();
    expect(unpaidLink()).toBeNull();
    expect(document.querySelector(".ui-banner, .ui-banner-rows")).toBeNull();
  });

  it("opens with the review as the box's one filled button, then the unpaid row (FLOW-958)", () => {
    renderHome({ review: 7, unpaid: 3, gross: 2_340_000n });
    const review = screen.getByRole("link", { name: "לאישור 7 פריטים · כ־2 דקות" });
    const unpaid = screen.getByRole("link", { name: "3 חשבוניות פתוחות ₪23,400 · לגבייה" });
    expect(review).toHaveAttribute("href", "/review");
    expect(review).toHaveClass("ui-btn");
    expect(unpaid).toHaveAttribute("href", "/unpaid");
    expect(review.compareDocumentPosition(unpaid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(unpaid.querySelector('.ui-row-hint bdi[dir="ltr"]')).toHaveTextContent("₪23,400");
    expect(document.querySelectorAll(".ui-btn")).toHaveLength(1);
  });

  it("puts the attention box right after the band, before the split card (FLOW-958)", () => {
    renderHome({ review: 7, unpaid: 3, gross: 2_340_000n });
    const attention = screen.getByRole("region", { name: "דורש טיפול" });
    const split = document.querySelector(".ui-home-split");
    expect(split).not.toBeNull();
    expect(attention.compareDocumentPosition(split as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses singular copy for one of each, with distinct names", () => {
    renderHome({ review: 1, unpaid: 1, gross: 468_000n });
    expect(screen.getByRole("link", { name: "לאישור פריט אחד · פחות מדקה" })).toHaveAttribute("href", "/review");
    expect(screen.getByRole("link", { name: "חשבונית פתוחה אחת ₪4,680 · לגבייה" })).toHaveAttribute("href", "/unpaid");
    expect(screen.queryByText(/פריטים/)).toBeNull();
    expect(screen.queryByText(/חשבוניות/)).toBeNull();
  });

  it("shows only the review button when nothing is unpaid, singular and plural", () => {
    const { unmount } = renderHome({ review: 1, unpaid: 0 });
    expect(screen.getByRole("link", { name: "לאישור פריט אחד · פחות מדקה" })).toHaveClass("ui-btn");
    expect(unpaidLink()).toBeNull();
    expect(document.querySelector(".ui-home-attention :is(.ui-banner, .ui-banner-rows)")).toBeNull();
    unmount();
    renderHome({ review: 12, unpaid: 0 });
    expect(screen.getByRole("link", { name: "לאישור 12 פריטים · כ־4 דקות" })).toHaveAttribute("href", "/review");
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
      expect(screen.getByRole("link", { name: "לאישור 3 פריטים · כדקה" })).toBeInTheDocument();
      expect(unpaidLink()).toBeNull();
      unmount();
    }
  });
});

describe("Home's sync strip (board States, syncing)", () => {
  it("says what syncs while a refresh runs", () => {
    renderHome({ review: 0, unpaid: 0, syncing: "מסנכרן עם Mercury…" });
    expect(document.querySelector(".ui-sync")?.textContent).toBe("מסנכרן עם Mercury…");
  });

  it("draws no strip when nothing syncs", () => {
    renderHome({ review: 0, unpaid: 0 });
    expect(document.querySelector(".ui-sync")).toBeNull();
  });
});
