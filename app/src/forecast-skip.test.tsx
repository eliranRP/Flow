import type { ForecastOverrideRow } from "@flow/shared";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "./test-render";
import { forecastKeyOf, futureForecastKey, projectRowForecastKey, scheduleForecastKey, skippedKeys, useForecastSkip } from "./forecast-skip";
import type { ScheduleRow } from "./recurring-schedule";

// The write fails: its onError runs, as useWrite's does after the server refuses.
const writes = vi.hoisted(() => ({ fail: true }));
vi.mock("./forecast-month", async (original) => ({
  ...(await original<typeof import("./forecast-month")>()),
  useSetForecastItem: () => ({
    isPending: false,
    mutate: (_payload: unknown, options?: { onError?: () => void }) => {
      if (writes.fail) options?.onError?.();
    },
  }),
}));

// One read: a new array each render would be a new read, which drops the page's answers.
const READ: ForecastOverrideRow[] = [];

function Probe() {
  const skip = useForecastSkip("2026-11", "נובמבר", READ);
  return (
    <button type="button" onClick={() => { skip.set("party:expense:power:USD", true, "Brightline Power"); }}>
      {skip.skipped.has("party:expense:power:USD") ? "out" : "in"}
    </button>
  );
}

// FLOW-1079: the forecast item a schedule row is, and the month's items taken out.
describe("forecast skip keys", () => {
  const row = { direction: "expense" as const, party_id: "power", currency: "USD", project_id: "p1" };

  it("keys a charge as the month forecast does, with its project only when the party is split", () => {
    expect(forecastKeyOf(row, false)).toBe("party:expense:power:USD");
    expect(forecastKeyOf(row, true)).toBe("party:expense:power:USD:p1");
    expect(forecastKeyOf({ ...row, project_id: null }, true)).toBe("party:expense:power:USD:none");
  });

  it("reads the items moved out of the month, not the ones only changed", () => {
    const keys = skippedKeys([
      { item_key: "party:expense:power:USD", amount_minor: null, due_on: null, moved_out: true },
      { item_key: "party:income:rent:USD", amount_minor: 90_000, due_on: null, moved_out: false },
    ]);
    expect([...keys]).toEqual(["party:expense:power:USD"]);
  });
});

// FLOW-1079 r1: a failed write takes the answer back, so the row returns to where the forecast counts it.
describe("forecast skip keys by screen (FLOW-1081)", () => {
  const charge = (party: string, project: string | null, currency = "USD") => ({ direction: "expense", party_id: party, currency, project_id: project }) as unknown as ScheduleRow;
  const power = charge("power", "p1");
  const hoa = charge("hoa", "p1");
  const fx = charge("fx", null, "EUR");
  const schedule = [power, charge("power", "p2"), hoa, fx];

  it("keys a schedule row split only when its party has another charge in the currency, and not at all in another currency", () => {
    expect(scheduleForecastKey(schedule, power, "USD")).toBe("party:expense:power:USD:p1");
    expect(scheduleForecastKey(schedule, hoa, "USD")).toBe("party:expense:hoa:USD");
    expect(scheduleForecastKey(schedule, fx, "USD")).toBeUndefined();
  });

  it("keys a project page's row by the page's project, and the general page's by the party's own charge", () => {
    expect(projectRowForecastKey("rec:expense:power", schedule, "p2", false, "USD")).toBe("party:expense:power:USD:p2");
    expect(projectRowForecastKey("rec:expense:hoa", schedule, "p1", false, "USD")).toBe("party:expense:hoa:USD");
    expect(projectRowForecastKey("rec:expense:power", [charge("power", null), charge("power", "p1")], "overhead", true, "USD")).toBe("party:expense:power:USD:none");
    expect(projectRowForecastKey("bill:1", schedule, "p1", false, "USD")).toBeUndefined();
  });

  it("keys a month to come's row by its part's project when the party is expected in more than one part", () => {
    const part = (keys: string[]) => ({ forecast: { rows: keys.map((key) => ({ key })), removed: [], skipped: [] } });
    const keyOf = futureForecastKey({ parts: [part(["rec:expense:power", "rec:expense:hoa"]), part(["rec:expense:power"])] } as never, "USD");
    expect(keyOf("rec:expense:power", "p2")).toBe("party:expense:power:USD:p2");
    expect(keyOf("rec:expense:hoa", "p1")).toBe("party:expense:hoa:USD");
  });

  it("keys a month to come's row as this month does when the forecast names its split parties (FLOW-1096)", () => {
    const part = (keys: string[]) => ({ forecast: { rows: keys.map((key) => ({ key })), removed: [], skipped: [] } });
    // The party has two charges, but only one is due this month: still split, as the month forecast and the project's צפי page key it.
    const keyOf = futureForecastKey({ parts: [part(["rec:expense:power"])], splitKeys: new Set(["party:expense:power:USD"]) } as never, "USD");
    expect(keyOf("rec:expense:power", "p2")).toBe("party:expense:power:USD:p2");
    expect(keyOf("rec:expense:hoa", "p1")).toBe("party:expense:hoa:USD");
  });
});

describe("useForecastSkip", () => {
  it("puts the charge back when the write fails", () => {
    renderWithProviders(<Probe />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "in" })); });
    expect(screen.getByRole("button", { name: "in" })).toBeInTheDocument();
  });

  it("keeps the answer while the write goes through", () => {
    writes.fail = false;
    renderWithProviders(<Probe />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "in" })); });
    expect(screen.getByRole("button", { name: "out" })).toBeInTheDocument();
    writes.fail = true;
  });
});
