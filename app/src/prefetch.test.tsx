import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PrefetchProjects, projectLink } from "./prefetch";
import { BooksProvider } from "./use-books";

describe("projectLink", () => {
  it("reads a project page link and nothing deeper", () => {
    expect(projectLink("/projects/p1?period=all")).toEqual({ projectId: "p1", search: "?period=all" });
    expect(projectLink("/projects/p%201")).toEqual({ projectId: "p 1", search: "" });
    expect(projectLink("/projects/p1/months")).toBeNull();
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
    return { query, view };
  }

  it("reads a project the moment its row is touched, on the link's period", () => {
    const { query, view } = setup("/");
    fireEvent.pointerDown(view.getByText("הגדרות"));
    expect(query).not.toHaveBeenCalled();
    fireEvent.pointerDown(view.getByText("פרויקט"));
    expect(query).toHaveBeenCalledTimes(1);
    const options = query.mock.calls[0]?.[0] as { queryKey: unknown[]; staleTime: number };
    expect(options.queryKey.slice(0, 3)).toEqual(["project", "off", "p7"]);
    // period=all reads with no range, like the page it opens.
    expect(options.queryKey.slice(3)).toEqual([null, null]);
    expect(options.staleTime).toBeGreaterThan(0);
  });

  it("reads nothing in preview", () => {
    const { query, view } = setup("/?preview=1");
    fireEvent.pointerDown(view.getByText("פרויקט"));
    expect(query).not.toHaveBeenCalled();
  });
});
