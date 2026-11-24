import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSetForecastItem } from "./forecast-month";
import { QUERY_STALE_MS } from "./query-client";
import { renderWithProviders } from "./test-render";
import { israelToday } from "./ui/date-math";

// FLOW-1315 (r2): after a reload a kept project forecast is in the cache before any project page code has loaded. A skip written then
// (Home, or the charge's page) has no project patch to move it, so it must not stay: it would draw the figures from before the skip
// until the read. This file imports forecast-month only, as a session that has not opened a project page; the page's code is loaded
// (dynamic import) after the skip, as opening the project does.
const rpc = vi.hoisted((): { calls: Array<{ name: string; args: unknown }>; forecast: unknown } => ({ calls: [], forecast: null }));
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return Promise.resolve({ data: name === "project_forecast" ? rpc.forecast : null, error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const MONTH = "2026-11";

function Skip() {
  const set = useSetForecastItem(MONTH);
  return <button type="button" onClick={() => { set.mutate({ key: "party:expense:power:USD", patch: { moved_out: true }, undo: false, prior: null }); }}>skip</button>;
}

describe("a skip before the project page's code has loaded (FLOW-1315)", () => {
  it("drops the kept project forecast, so opening the project reads fresh and never draws the pre-skip figures", async () => {
    const { sampleProjectForecastAnswer } = await import("./project-forecast-sample");
    const answer = sampleProjectForecastAnswer();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
    const key = ["month-forecast", "off", "project", "juniper-ct", MONTH, israelToday(), "company"];
    // As restored from the device: the answer's figures before the skip, mapped (the kept copy is restored to the page's own shape).
    const { projectForecastOf } = await import("./project-forecast-map");
    client.setQueryData(key, projectForecastOf(answer, "juniper-ct"));
    client.setQueryData(["company-currency", "off"], "USD");
    renderWithProviders(<Skip />, { route: "/", client });
    fireEvent.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    expect(client.getQueryData(key)).toBeUndefined();

    // Opening the project now: the read is sent, and the page draws only what it answers (the power bill skipped).
    rpc.forecast = { ...answer, expense_minor: 34_000, net_minor: 381_000, cash_expense_minor: 34_000, cash_net_minor: 381_000, rows: (answer.rows as Array<{ key: string }>).filter((row) => row.key !== "rec:expense:power") };
    const { useProjectNextMonth } = await import("./next-month-for-project");
    const seen: Array<bigint | null> = [];
    function Open() {
      seen.push(useProjectNextMonth("juniper-ct", "USD", undefined, true, MONTH).forecast?.expenseMinor ?? null);
      return null;
    }
    renderWithProviders(<Open />, { route: "/", client });
    await waitFor(() => { expect(seen.at(-1)).toBe(34_000n); });
    expect(seen).not.toContain(43_500n);
    expect(rpc.calls.filter((call) => call.name === "project_forecast")).toHaveLength(1);
  });
});
