import { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { priorPatch, useResetForecastMonth, useSetForecastItem } from "./forecast-month";
import { useProjectNextMonth } from "./next-month-for-project";
import { projectForecastOf, type ProjectForecastRead } from "./project-forecast-map";
import { projectForecastKey } from "./project-forecast-query";
import { SAMPLE_MONTH, SAMPLE_TODAY, sampleProjectForecastAnswer } from "./project-forecast-sample";
import { useProjectForecastWrites } from "./project-forecast-writes";
import { QUERY_STALE_MS } from "./query-client";
import { renderWithProviders } from "./test-render";
import { israelToday } from "./ui/date-math";

// FLOW-1315 (the lesson of FLOW-1308's review): a skip, its undo, a reset and the project page's own removal change the figures on
// the tap, in the forecast the page holds, with no read; a failed write puts them back; the forecasts no screen holds are dropped,
// so none shows figures from before the write. The answers are invented (the sample's: two rents, a power bill, two averages).
type Answer = { data: unknown; error: unknown };
type Server = {
  calls: Array<{ name: string; args: unknown }>;
  forecast: unknown;
  /** The answer a write waits for: a test replaces it to hold the write or to refuse it. */
  write: (name: string) => Promise<Answer>;
};
const server = vi.hoisted((): Server => ({
  calls: [],
  forecast: null,
  write: () => Promise.resolve({ data: null, error: null }),
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      server.calls.push({ name, args });
      if (name === "project_forecast") return Promise.resolve({ data: server.forecast, error: null });
      if (name === "set_forecast_item" || name === "reset_forecast_month" || name === "remove_project_forecast_row") return server.write(name);
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const PROJECT = "juniper-ct";
const POWER = "party:expense:power:USD";
const KIM = "party:income:kim:USD";

function Harness() {
  const next = useProjectNextMonth(PROJECT, "USD", undefined, true, SAMPLE_MONTH);
  const set = useSetForecastItem(SAMPLE_MONTH);
  const reset = useResetForecastMonth(SAMPLE_MONTH);
  const writes = useProjectForecastWrites(PROJECT, SAMPLE_MONTH);
  const forecast = next.forecast;
  return (
    <>
      <p data-testid="figures">{forecast == null ? "loading" : [forecast.incomeMinor, forecast.expenseMinor, forecast.netMinor].join(" ")}</p>
      <p data-testid="rows">{forecast?.rows.map((row) => row.key).join(" ")}</p>
      <p data-testid="skipped">{forecast?.skipped?.map((row) => row.key).join(" ")}</p>
      <p data-testid="removed">{forecast?.removed.map((row) => row.key).join(" ")}</p>
      <p data-testid="overrides">{next.overrides?.map((row) => `${row.item_key}:${String(row.moved_out)}`).join(" ")}</p>
      <p data-testid="note">{next.income == null ? "" : `${String(next.income.rows)} ${String(next.income.recurring)} ${String(next.income.rent)} ${next.income.name ?? "-"}`}</p>
      <button type="button" onClick={() => { set.mutate({ key: POWER, patch: { moved_out: true }, undo: false, prior: null }); }}>skip power</button>
      <button type="button" onClick={() => { set.mutate({ key: POWER, patch: priorPatch(null), undo: true, prior: null }); }}>undo power</button>
      <button type="button" onClick={() => { set.mutate({ key: KIM, patch: { moved_out: true }, undo: false, prior: null }); }}>skip kim</button>
      <button type="button" onClick={() => { set.mutate({ key: "party:expense:other:USD", patch: { moved_out: true }, undo: false, prior: null }); }}>skip other</button>
      <button type="button" onClick={() => { reset.mutate(undefined); }}>reset</button>
      <button type="button" onClick={() => { writes.mutate({ fn: "remove_project_forecast_row", rowKey: "rec:expense:power", message: "הוסר" }); }}>remove power</button>
    </>
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: QUERY_STALE_MS } } });
}

function pageClient() {
  const client = newClient();
  client.setQueryData(["company-currency", "off"], "USD");
  return client;
}

const text = (id: string) => screen.getByTestId(id).textContent;
const reads = () => server.calls.filter((call) => call.name === "project_forecast");
const FIGURES = "415000 43500 371500";
const ALL_ROWS = "rec:income:ortiz rec:income:kim rec:expense:power avg:repairs avg:none";

/** The answer the server gives once the power bill is skipped (what the read after the write brings). */
function skippedAnswer() {
  const answer = sampleProjectForecastAnswer() as { rows: Array<{ key: string }> };
  const power = answer.rows.find((row) => row.key === "rec:expense:power");
  return { ...answer, expense_minor: 34_000, net_minor: 381_000, cash_expense_minor: 34_000, cash_net_minor: 381_000, rows: answer.rows.filter((row) => row.key !== "rec:expense:power"), skipped: [power], overrides: [{ item_key: POWER, moved_out: true }] };
}

beforeEach(() => {
  server.calls.length = 0;
  server.forecast = sampleProjectForecastAnswer();
  server.write = () => Promise.resolve({ data: null, error: null });
});

describe("a skip changes the project's figures on the tap (FLOW-1315)", () => {
  it("the figures, the rows and the override follow the tap while the write is still out, and the read after the write brings the server's answer", async () => {
    let answer: (value: Answer) => void = () => undefined;
    server.write = () => new Promise<Answer>((resolve) => { answer = resolve; });
    const client = pageClient();
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    expect(text("rows")).toBe(ALL_ROWS);
    fireEvent.click(screen.getByRole("button", { name: "skip power" }));
    // At the tap: the bill leaves the rows and the expense, joins the rows a skip took out, and the override is there.
    await waitFor(() => { expect(text("figures")).toBe("415000 34000 381000"); });
    expect(text("rows")).toBe("rec:income:ortiz rec:income:kim avg:repairs avg:none");
    expect(text("skipped")).toBe("rec:expense:power");
    expect(text("overrides")).toBe(`${POWER}:true`);
    expect(client.isMutating()).toBe(1);
    expect(reads()).toHaveLength(1);
    server.forecast = skippedAnswer();
    answer({ data: null, error: null });
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect(reads()).toHaveLength(2); });
    expect(text("figures")).toBe("415000 34000 381000");
    expect(text("skipped")).toBe("rec:expense:power");
  });

  it("the undo puts the row back in its place and the figures as they were, at the tap", async () => {
    server.write = () => new Promise<Answer>(() => undefined);
    renderWithProviders(<Harness />, { route: "/", client: pageClient() });
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    fireEvent.click(screen.getByRole("button", { name: "skip power" }));
    await waitFor(() => { expect(text("figures")).toBe("415000 34000 381000"); });
    fireEvent.click(screen.getByRole("button", { name: "undo power" }));
    // The writes of a month run one after another; the cache is patched at each tap.
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    expect(text("rows")).toBe(ALL_ROWS);
    expect(text("skipped")).toBe("");
    expect(text("overrides")).toBe(`${POWER}:false`);
  });

  it("a skipped income row leaves the income and the card's note counts follow", async () => {
    server.write = () => new Promise<Answer>(() => undefined);
    renderWithProviders(<Harness />, { route: "/", client: pageClient() });
    await waitFor(() => { expect(text("note")).toBe("2 2 2 -"); });
    fireEvent.click(screen.getByRole("button", { name: "skip kim" }));
    await waitFor(() => { expect(text("figures")).toBe("185000 43500 141500"); });
    // One rent left: the note names it by its row (a single income row is named). Rent stays counted from the rows' own rent.
    expect(text("note")).toBe("1 1 1 M. Ortiz");
  });

  it("a skip of a charge this project has no row for changes no figure, and is still an override", async () => {
    server.write = () => new Promise<Answer>(() => undefined);
    renderWithProviders(<Harness />, { route: "/", client: pageClient() });
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    fireEvent.click(screen.getByRole("button", { name: "skip other" }));
    await waitFor(() => { expect(text("overrides")).toBe("party:expense:other:USD:true"); });
    expect(text("figures")).toBe(FIGURES);
    expect(text("rows")).toBe(ALL_ROWS);
  });

  it("a failed write puts the figures back and reads the forecast again", async () => {
    let refuse: () => void = () => undefined;
    server.write = () => new Promise<Answer>((resolve) => { refuse = () => { resolve({ data: null, error: { message: "refused" } }); }; });
    const client = pageClient();
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    fireEvent.click(screen.getByRole("button", { name: "skip power" }));
    await waitFor(() => { expect(text("figures")).toBe("415000 34000 381000"); });
    refuse();
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    expect(text("rows")).toBe(ALL_ROWS);
    expect(text("overrides")).toBe("");
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    // The cache ends at the server's answer (FLOW-1214's rule): the forecast on screen is read again.
    await waitFor(() => { expect(reads()).toHaveLength(2); });
    await screen.findByText("לא הצלחנו לעדכן את הצפי");
  });

  it("a reset takes the month's skips off and the rows come back", async () => {
    server.forecast = skippedAnswer();
    renderWithProviders(<Harness />, { route: "/", client: pageClient() });
    await waitFor(() => { expect(text("figures")).toBe("415000 34000 381000"); });
    server.write = () => new Promise<Answer>(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    expect(text("rows")).toBe(ALL_ROWS);
    expect(text("skipped")).toBe("");
  });

  it("drops the forecasts no screen holds when the write is done (another project's, another month's) and keeps the one on screen", async () => {
    const client = pageClient();
    const other = projectForecastKey("off", "other-project", SAMPLE_MONTH, SAMPLE_TODAY, null);
    const later = projectForecastKey("off", PROJECT, "2026-12", SAMPLE_TODAY, null);
    client.setQueryData(other, projectForecastOf(sampleProjectForecastAnswer(), "other-project"));
    client.setQueryData(later, projectForecastOf(sampleProjectForecastAnswer(), PROJECT));
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    fireEvent.click(screen.getByRole("button", { name: "skip power" }));
    await waitFor(() => { expect(client.isMutating()).toBe(0); });
    await waitFor(() => { expect(client.getQueryData(other)).toBeUndefined(); });
    expect(client.getQueryData(later)).toBeUndefined();
    expect(client.getQueryData(projectForecastKey("off", PROJECT, SAMPLE_MONTH, israelToday(), null))).toBeDefined();
  });

  it("patches a project's forecast no screen holds at the tap too, so a project opened in between never shows the old figures", async () => {
    const client = pageClient();
    const other = projectForecastKey("off", "other-project", SAMPLE_MONTH, SAMPLE_TODAY, null);
    client.setQueryData(other, projectForecastOf(sampleProjectForecastAnswer(), "other-project"));
    server.write = () => new Promise<Answer>(() => undefined);
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    fireEvent.click(screen.getByRole("button", { name: "skip power" }));
    await waitFor(() => { expect(client.getQueryData<ProjectForecastRead>(other)?.forecast.expenseMinor).toBe(34_000n); });
  });
});

describe("the project page's own removal (FLOW-1315)", () => {
  it("takes the row out of the figures at the tap, and drops the project's other forecasts when the write is done", async () => {
    let answer: (value: Answer) => void = () => undefined;
    server.write = () => new Promise<Answer>((resolve) => { answer = resolve; });
    const client = pageClient();
    const later = projectForecastKey("off", PROJECT, "2026-12", SAMPLE_TODAY, null);
    client.setQueryData(later, projectForecastOf(sampleProjectForecastAnswer(), PROJECT));
    renderWithProviders(<Harness />, { route: "/", client });
    await waitFor(() => { expect(text("figures")).toBe(FIGURES); });
    fireEvent.click(screen.getByRole("button", { name: "remove power" }));
    await waitFor(() => { expect(text("figures")).toBe("415000 34000 381000"); });
    expect(text("removed")).toBe("rec:expense:power");
    expect(text("skipped")).toBe("");
    expect(reads()).toHaveLength(1);
    answer({ data: null, error: null });
    await waitFor(() => { expect(client.getQueryData(later)).toBeUndefined(); });
    await waitFor(() => { expect(reads()).toHaveLength(2); });
  });
});
