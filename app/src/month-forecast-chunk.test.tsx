import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMonthForecastQuery } from "./month-forecast-query";
import { renderWithProviders } from "./test-render";
import { israelToday } from "./ui/date-math";

// FLOW-1273: the forecast builder's chunk is requested with the reads, not after the last answer. Invented answers only.
const seen = vi.hoisted(() => ({ events: [] as string[], release: null as null | (() => void) }));

vi.mock("./month-forecast-build", async (importOriginal) => {
  seen.events.push("build-import-started");
  return importOriginal<typeof import("./month-forecast-build")>();
});
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string) => {
      seen.events.push(`rpc:${name}`);
      const data = answers[name] ?? null;
      // The last read is held, so the test sees what has started before the reads answer.
      if (name === "company_forecast_edits_for") {
        return new Promise((resolve) => { seen.release = () => { resolve({ data, error: null }); }; });
      }
      return Promise.resolve({ data, error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const today = israelToday();
const month = today.slice(0, 7);
const answers: Record<string, unknown> = {
  mcp_company_loan_currency: "ILS",
  expected_months: { today, project_id: null, months: [], recurring: [] },
  company_forecast_edits_for: { month, overhead_project_id: null, edits: [] },
  forecast_overrides_for: [],
  list_unpaid: [],
};

function Probe() {
  useMonthForecastQuery(month);
  return null;
}

beforeEach(() => {
  seen.events.length = 0;
  seen.release = null;
});

describe("the month forecast's builder loads beside its reads (FLOW-1273)", () => {
  it("requests the builder chunk before the forecast reads have answered, and still builds from it", async () => {
    const { client } = renderWithProviders(<Probe />, { route: "/" });
    await waitFor(() => { expect(seen.release).not.toBeNull(); });
    // The reads are still open here: the chunk has been asked for already.
    expect(seen.events).toContain("build-import-started");
    seen.release?.();
    await waitFor(() => { expect(client.getQueryData(["month-forecast", "off", month])).toBeDefined(); });
  });
});
