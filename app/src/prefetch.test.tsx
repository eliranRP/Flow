import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { monthPeriod } from "./period";
import { PrefetchProjects, projectLink } from "./prefetch";
import { markDay } from "./project-category-months";
import { nextMonthKey } from "./project-next-month";
import { FORECAST_EDITS_KEY } from "./project-next-month-query";
import { israelToday } from "./ui/date-math";
import { BooksProvider } from "./use-books";

describe("projectLink", () => {
  it("reads a project page link and nothing deeper", () => {
    expect(projectLink("/projects/p1?period=all")).toEqual({ projectId: "p1", search: "?period=all" });
    expect(projectLink("/projects/p%201")).toEqual({ projectId: "p 1", search: "" });
    expect(projectLink("/projects/p1/profit")).toBeNull();
    expect(projectLink("/projects")).toBeNull();
    expect(projectLink("/review")).toBeNull();
  });
});

describe("PrefetchProjects (FLOW-804)", () => {
  function setup(path: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const query = vi.spyOn(client, "query").mockResolvedValue(undefined);
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <BooksProvider>
            <PrefetchProjects />
            <a href="/projects/p7?period=all">פרויקט</a>
            <a href="/settings">הגדרות</a>
          </BooksProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return { client, query, view };
  }

  it("reads a project the moment its row is touched, on the link's period", () => {
    const { query, view } = setup("/");
    fireEvent.pointerDown(view.getByText("הגדרות"));
    expect(query).not.toHaveBeenCalled();
    fireEvent.pointerDown(view.getByText("פרויקט"));
    // The project and its cash (FLOW-419: the page opens on the cash), then FLOW-1270's: the project over every
    // period and the forecast's reads. The ⋯ menu's figures are not read here: the menu primes its own read on its
    // button (FLOW-1212).
    // The forecast's five come after its module loads.
    expect(query).toHaveBeenCalledTimes(3);
    const options = query.mock.calls[0]?.[0] as { queryKey: unknown[]; staleTime: number };
    expect(options.queryKey.slice(0, 3)).toEqual(["project", "off", "p7"]);
    // period=all reads with no range, like the page it opens.
    expect(options.queryKey.slice(3)).toEqual([null, null]);
    expect(options.staleTime).toBeGreaterThan(0);
    const cash = query.mock.calls[1]?.[0] as { queryKey: unknown[]; staleTime: number };
    expect(cash.queryKey.slice(0, 4)).toEqual(["dashboard", "project-cash-months", "off", "p7"]);
    expect(cash.staleTime).toBeGreaterThan(0);
    expect(query.mock.calls.some((call) => JSON.stringify((call[0] as { queryKey: unknown[] }).queryKey).includes("projects-cash"))).toBe(false);
  });

  it("reads the all-time project and the forecast's reads under the keys the page reads (FLOW-1270)", async () => {
    const { query, view } = setup("/");
    fireEvent.pointerDown(view.getByText("פרויקט"));
    await vi.waitFor(() => { expect(query).toHaveBeenCalledTimes(8); });
    const keys = query.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    const today = israelToday();
    const month = nextMonthKey(today);
    expect(keys).toContainEqual(["project", "off", "p7", null, null]);
    expect(keys).toContainEqual(["company-overhead", "off"]);
    expect(keys).toContainEqual(["expected-months", "off", "project", "p7", 0]);
    expect(keys).toContainEqual(["project", "category-months", "off", "p7", markDay(monthPeriod(today.slice(0, 7)))]);
    expect(keys).toContainEqual([FORECAST_EDITS_KEY, "off", "p7", month]);
    expect(keys).toContainEqual(["month-forecast", "off", "overrides", month]);
    // With the page's staleTime and no retries.
    for (const call of query.mock.calls) expect(call[0]).toMatchObject({ retry: false, staleTime: expect.any(Number) as number });
  });

  it("starts none of the project's own forecast reads on the company's overhead project, when its answer is cached (FLOW-1297)", async () => {
    const { client, query, view } = setup("/");
    client.setQueryData(["company-overhead", "off"], { id: "p7", name: "הוצאות כלליות" });
    fireEvent.pointerDown(view.getByText("פרויקט"));
    await vi.waitFor(() => {
      expect(query.mock.calls.some((call) => JSON.stringify((call[0] as { queryKey: unknown[] }).queryKey) === JSON.stringify(["company-overhead", "off"]))).toBe(true);
    });
    const today = israelToday();
    const month = nextMonthKey(today);
    const keys = query.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown[] }).queryKey));
    expect(keys).not.toContain(JSON.stringify(["expected-months", "off", "project", "p7", 0]));
    expect(keys).not.toContain(JSON.stringify(["project", "category-months", "off", "p7", markDay(monthPeriod(today.slice(0, 7)))]));
    expect(keys).not.toContain(JSON.stringify([FORECAST_EDITS_KEY, "off", "p7", month]));
    // The month's overrides are month-wide, not the project's own read, so the touch still starts them.
    expect(keys).toContain(JSON.stringify(["month-forecast", "off", "overrides", month]));
  });

  it("starts another project's forecast reads at once, without waiting for the overhead answer (FLOW-1297)", () => {
    const { query, view } = setup("/");
    // The overhead read never answers: the project's own reads must not wait for it.
    query.mockImplementation(() => new Promise(() => undefined));
    fireEvent.pointerDown(view.getByText("פרויקט"));
    return vi.waitFor(() => {
      const keys = query.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey: unknown[] }).queryKey));
      expect(keys).toContain(JSON.stringify(["expected-months", "off", "project", "p7", 0]));
    });
  });

  it("reads nothing in preview", () => {
    const { query, view } = setup("/?preview=1");
    fireEvent.pointerDown(view.getByText("פרויקט"));
    expect(query).not.toHaveBeenCalled();
  });

  it("reads no project while Home is idle", async () => {
    vi.useFakeTimers();
    try {
      const { client, query } = setup("/");
      act(() => {
        client.setQueryData(["dashboard", "off", "any"], { projects: [{ id: "a" }, { id: "b" }] });
      });
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(query).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads a touched project once, without retries", () => {
    const { query, view } = setup("/");
    fireEvent.pointerDown(view.getByText("פרויקט"));
    expect((query.mock.calls[0]?.[0] as { retry: unknown }).retry).toBe(false);
  });
});
