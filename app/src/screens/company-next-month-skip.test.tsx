import type { ExpectedParty, ForecastOverrideRow } from "@flow/shared";
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { companyCashForecast, companyNextMonthForecast, type CompanyForecastInput } from "../company-next-month";
import { renderWithProviders } from "../test-render";
import { CompanyNextMonthScreen } from "./company-next-month-screen";

/**
 * FLOW-1096: פירוט ועריכה builds the month again with its own answers, so a row taken out or put back moves at
 * once (and the sums with it), not on the read after the write. Invented figures, USD cents.
 */

function charge(partyId: string, projectId: string | null, minor: bigint): ExpectedParty {
  return {
    direction: "expense",
    party_id: partyId,
    name: partyId,
    currency: "USD",
    typical_amount_minor: -minor,
    typical_day: 5,
    months_seen: 6,
    seen_this_month: true,
    project_id: projectId,
    category_id: "c-other",
    pace: "month",
    next_due_month: "2026-12",
    pays_loan: false,
  };
}

const INPUT: CompanyForecastInput = {
  currency: "USD",
  today: "2026-11-07",
  month: "2026-12",
  recurring: [charge("Brightline Power", "p1", 18_600n), charge("Juniper Pointe HOA", "p1", 31_000n)],
  loans: [],
  categories: [{ id: "c-other", name: "אחר", loan_part: null, excluded_from_pnl: false }],
  inputs: { month: "2026-12", overhead_project_id: null, projects: [{ project_id: "p1", categories: [] }], general: [], edits: [] },
};
const POWER = "party:expense:Brightline Power:USD";
const OVERRIDES: ForecastOverrideRow[] = [{ item_key: POWER, amount_minor: null, due_on: null, moved_out: true }];

const writes = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("../forecast-month", async (original) => ({
  ...(await original<typeof import("../forecast-month")>()),
  useSetForecastItem: () => ({ isPending: false, mutate: (payload: unknown) => { writes.calls.push(payload); } }),
}));
vi.mock("./company-cash-next-month", async (original) => ({
  ...(await original<typeof import("./company-cash-next-month")>()),
  useCompanyCashNextMonth: () => ({
    forecast: companyCashForecast(companyNextMonthForecast({ ...INPUT, skips: [POWER] })),
    input: INPUT,
    overrides: OVERRIDES,
    loading: false,
    failed: false,
    paused: false,
    refetch: () => Promise.resolve(),
    categories: [],
    profitMinor: 0n,
  }),
}));
vi.mock("../project-cash", async (original) => ({
  ...(await original<typeof import("../project-cash")>()),
  useProjectsCashMonth: () => ({
    data: { base_currency: "USD", projects: [{ id: "p1", name: "Birch Lane", is_overhead: false, status: "active" }] },
    isPending: false,
    isError: false,
    isPaused: false,
    refetch: () => Promise.resolve(),
  }),
}));
vi.mock("../forecast-page-month", async (original) => ({
  ...(await original<typeof import("../forecast-page-month")>()),
  useForecastMonth: () => "2026-12",
}));
vi.mock("../use-is-viewer", async (original) => ({
  ...(await original<typeof import("../use-is-viewer")>()),
  useHoldWrites: () => false,
  useCompanyRole: () => "owner",
}));

/** A full swipe on a row, with reduced motion so the row goes at once (as ui/swipe-row.test.tsx does). */
function swipeOut(frame: HTMLElement) {
  window.matchMedia = ((query: string) => ({ matches: query.includes("prefers-reduced-motion"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia;
  frame.getBoundingClientRect = () => ({ width: 300, height: 80, top: 100, left: 37, right: 337, bottom: 180, x: 37, y: 100, toJSON: () => ({}) });
  fireEvent.touchStart(frame, { touches: [{ clientX: 100, clientY: 130 }] });
  fireEvent.touchMove(frame, { touches: [{ clientX: 260, clientY: 130 }] });
  fireEvent.touchEnd(frame, { touches: [], changedTouches: [{ clientX: 260, clientY: 130 }] });
}

describe("פירוט ועריכה's skips (FLOW-1096)", () => {
  it("puts a row back in its project at once, with the project's sum", () => {
    renderWithProviders(<CompanyNextMonthScreen />);
    const taken = screen.getByRole("region", { name: "הוצא מהצפי" });
    expect(within(taken).getByText("Brightline Power")).toBeTruthy();
    const project = screen.getByRole("region", { name: "Birch Lane" });
    expect(within(project).queryByText("Brightline Power")).toBeNull();

    const frame = taken.querySelector<HTMLElement>(".ui-swipe-row");
    if (frame == null) throw new Error("no swipe row");
    swipeOut(frame);
    expect(writes.calls).toHaveLength(1);
    expect(within(screen.getByRole("region", { name: "Birch Lane" })).getByText("Brightline Power")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "הוצא מהצפי" })).toBeNull();
  });
});
