import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { cashMonthKey } from "../cash";
import { sampleCashMonths } from "../dev/cash-sample";
import { renderWithProviders } from "../test-render";
import type { ChargeChangeView } from "../forecast";
import type { HomeActivityData } from "./home-activity";
import { AttentionCards } from "../ui/attention-cards";
import type { BannerRow } from "../ui/banner";
import { attentionRows, CashHome } from "./HomeScreen";

const ACTIVITY: HomeActivityData = { schedule: [], scheduleFailed: false, lines: [], linesFailed: false, onRetry: () => undefined };

/** The live Home's rows: the unpaid figures count only while unpaid is ready (HomeScreen). */
function renderHome({
  review,
  unpaid,
  gross = 0n,
  phase = "ready",
  search = "",
  syncing = null,
  changes = [],
}: {
  review: number;
  unpaid: number;
  gross?: bigint;
  phase?: "loading" | "error" | "empty" | "ready";
  search?: string;
  syncing?: string | null;
  changes?: ChargeChangeView[];
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
        changes,
        search,
      })}
      activity={ACTIVITY}
      syncing={syncing}
      onStepMonth={() => undefined}
    />,
    { route: `/${search}` },
  );
}

const reviewLink = () => screen.queryByRole("link", { name: /לאישור/ });
const unpaidLink = () => screen.queryByRole("link", { name: /חשבוני(ת|ות) פתוח/ });

beforeEach(() => {
  window.localStorage.clear();
});

describe("Home's attention cards (FLOW-321, FLOW-1036)", () => {
  it("shows no section when nothing waits and nothing is unpaid", () => {
    renderHome({ review: 0, unpaid: 0 });
    expect(reviewLink()).toBeNull();
    expect(unpaidLink()).toBeNull();
    expect(document.querySelector(".ui-attn")).toBeNull();
  });

  it("puts the review card first, with no X, then the unpaid card with its X", () => {
    renderHome({ review: 7, unpaid: 3, gross: 2_340_000n });
    const review = screen.getByRole("link", { name: "7 פריטים ממתינים לאישור" });
    const unpaid = screen.getByRole("link", { name: /^3 חשבוניות פתוחות · /u });
    expect(review).toHaveAttribute("href", "/review");
    expect(unpaid).toHaveAttribute("href", "/unpaid");
    expect(review.compareDocumentPosition(unpaid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: /הסתרה: .*לאישור/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^הסתרה: 3 חשבוניות פתוחות · /u })).toBeInTheDocument();
  });

  it("comes before the month's activity", () => {
    renderHome({ review: 7, unpaid: 3, gross: 2_340_000n });
    const cards = document.querySelector(".ui-attn");
    const activity = screen.getByRole("region", { name: "תנועות החודש" });
    expect((cards as Element).compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps a hidden card hidden until what it counts changes", async () => {
    const { unmount } = renderHome({ review: 0, unpaid: 3, gross: 2_340_000n });
    fireEvent.click(screen.getByRole("button", { name: /^הסתרה: 3 חשבוניות פתוחות · /u }));
    await waitFor(() => {
      expect(unpaidLink()).toBeNull();
    });
    expect(screen.getByText("אין מה לטפל · הכול נסקר")).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem("flow.attention.home") ?? "{}")).toEqual({ unpaid: "unpaid:3:2340000" });
    unmount();
    // The same count and total: still hidden on this device.
    const again = renderHome({ review: 0, unpaid: 3, gross: 2_340_000n });
    expect(unpaidLink()).toBeNull();
    again.unmount();
    // Another invoice opened: the card shows again.
    renderHome({ review: 0, unpaid: 4, gross: 2_840_000n });
    expect(unpaidLink()).toBeInTheDocument();
  });

  it("brings hidden cards back from the section's head", async () => {
    renderHome({ review: 2, unpaid: 3, gross: 2_340_000n });
    fireEvent.click(screen.getByRole("button", { name: /^הסתרה: 3 חשבוניות פתוחות · /u }));
    const restore = await screen.findByRole("button", { name: "1 הוסתרו · הצגה" });
    fireEvent.click(restore);
    expect(unpaidLink()).toBeInTheDocument();
  });

  it("keys a changed charge by its id and its amount", () => {
    const change: ChargeChangeView = { id: "t1", title: "חשמל עלה", down: false, now: "$250", usual: "$180", href: "/transactions/t1" };
    const [row] = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: [change], search: "" });
    expect(row?.dismissKey).toBe("change:t1:$250");
    const [both] = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: [change, { ...change, id: "t2" }], search: "" });
    expect(both?.dismissKey).toBe("changes:2:t1+t2");
    const [review] = attentionRows({ pending: 3, unpaidCount: 0, unpaidGross: 0n, search: "" });
    expect(review?.dismissKey).toBeUndefined();
  });

  it("keeps the preview search on both cards", () => {
    renderHome({ review: 2, unpaid: 2, gross: 200_000n, search: "?preview=1" });
    expect(reviewLink()).toHaveAttribute("href", "/review?preview=1");
    expect(unpaidLink()).toHaveAttribute("href", "/unpaid?preview=1");
  });

  it("drops the unpaid card while unpaid is loading or failed", () => {
    for (const phase of ["loading", "error"] as const) {
      const { unmount } = renderHome({ review: 3, unpaid: 2, gross: 200_000n, phase });
      expect(reviewLink()).toBeInTheDocument();
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

// FLOW-1255: a hide applies to the item the person hid, not to whichever late item is next.
describe("a hidden named late row (FLOW-1255)", () => {
  const late = (name: string, partyId: string, projectId: string | null = null) =>
    attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: 1, missingName: name, missingTarget: { partyId, projectId }, search: "" });
  const renderRows = (rows: BannerRow[]) => renderWithProviders(<AttentionCards rows={rows} storageKey="home" />);

  it("keys a named row by its party and project, and a count row by its count", () => {
    expect(late("A", "s-a")[0]?.dismissKey).toBe("missing:1:s-a:none");
    expect(late("A", "s-a", "p1")[0]?.dismissKey).toBe("missing:1:s-a:p1");
    const two = attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, missingCount: 2, missingName: "A", missingTarget: { partyId: "s-a", projectId: null }, search: "" });
    expect(two[0]?.dismissKey).toBe("missing:2");
  });

  it("keeps A's row hidden, and shows a new single late item B", () => {
    const first = renderRows(late("A", "s-a"));
    fireEvent.click(screen.getByRole("button", { name: /^הסתרה: / }));
    expect(JSON.parse(window.localStorage.getItem("flow.attention.home") ?? "{}")).toEqual({ missing: "missing:1:s-a:none" });
    first.unmount();
    const again = renderRows(late("A", "s-a"));
    expect(screen.queryByRole("link", { name: /החשבון של A/ })).toBeNull();
    again.unmount();
    renderRows(late("B", "s-b"));
    expect(screen.getByRole("link", { name: /החשבון של B/ })).toBeInTheDocument();
  });

  it("is not hidden by the old missing:1 key: a row hidden before this change shows once more", () => {
    window.localStorage.setItem("flow.attention.home", JSON.stringify({ missing: "missing:1" }));
    renderRows(late("A", "s-a"));
    expect(screen.getByRole("link", { name: /החשבון של A/ })).toBeInTheDocument();
  });
});
