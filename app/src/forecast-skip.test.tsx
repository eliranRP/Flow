import type { ForecastOverrideRow } from "@flow/shared";
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "./test-render";
import { forecastKeyOf, skippedKeys, useForecastSkip } from "./forecast-skip";

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
