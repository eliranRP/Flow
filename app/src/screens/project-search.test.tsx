import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { Dashboard } from "@flow/shared";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ProjectsScreen } from "./flow-screens";

function project(id: string, name: string, status: "active" | "finished" = "active"): Dashboard["projects"][number] {
  return {
    id,
    name,
    status,
    income_agorot: 1_000_000n,
    direct_agorot: 600_000n,
    shared_agorot: 0n,
    profit_before_shared_agorot: 400_000n,
    profit_agorot: 400_000n,
    by_currency: [],
  };
}

const names = ["בית ארז", "בית אלון", "בית ברוש", "בית דקל", "בית הדס", "בית ורד", "בית זית", "בית חצב"];

const sample = {
  projects: [
    ...names.map((name, index) => project(`a${String(index)}`, name)),
    project("f1", "מחסן תמר", "finished"),
    project("f2", "חנות רימון", "finished"),
  ],
} as unknown as Dashboard;

function renderProjects(data: Dashboard = sample) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/projects"]}>
            <ProjectsScreen sample={data} />
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** A row's name starts with the project's name, then its hint and amount. */
function rowName(name: string): RegExp {
  return new RegExp(`^${name}( |$)`);
}

function search(value: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "חיפוש פרויקט" }), { target: { value } });
}

describe("project search (FLOW-410)", () => {
  it("lists every active project and keeps finished ones behind the link", () => {
    renderProjects();
    for (const name of names) expect(screen.getByRole("link", { name: rowName(name) })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: rowName("מחסן תמר") })).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: /שהסתיימו/ });
    expect(more).toHaveTextContent("עוד 2 שהסתיימו");
    fireEvent.click(more);
    expect(screen.getByRole("link", { name: rowName("מחסן תמר") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /שהסתיימו/ })).not.toBeInTheDocument();
  });

  it("finds the seventh active project by name", () => {
    renderProjects();
    search("זית");
    expect(screen.getByRole("link", { name: rowName("בית זית") })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: rowName("בית ארז") })).not.toBeInTheDocument();
  });

  it("finds a finished project by name and marks it finished", () => {
    renderProjects();
    search("תמר");
    const row = screen.getByRole("link", { name: rowName("מחסן תמר") });
    expect(within(row).getByText("הסתיים")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: rowName("חנות רימון") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /שהסתיימו/ })).not.toBeInTheDocument();
  });

  it("matches active and finished projects together", () => {
    renderProjects();
    search("ר");
    expect(screen.getByRole("link", { name: rowName("בית ארז") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: rowName("חנות רימון") })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: rowName("מחסן תמר") })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: rowName("בית אלון") })).not.toBeInTheDocument();
  });

  it("offers the transaction search when no project matches (FLOW-342)", () => {
    renderProjects();
    search("חשמל");
    const row = screen.getByRole("link", { name: /^חיפוש בתנועות: חשמל/ });
    expect(row).toHaveAttribute("href", `/search?q=${encodeURIComponent("חשמל")}`);
    expect(screen.queryByRole("link", { name: rowName("בית ארז") })).not.toBeInTheDocument();
  });

  it("has no header magnifier; the filter is the page's one search (FLOW-342)", () => {
    renderProjects();
    expect(screen.queryByRole("link", { name: "חיפוש תנועות" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "חיפוש פרויקט" })).toBeInTheDocument();
  });

  it("names a single finished project in the singular", () => {
    renderProjects({ projects: [project("a", "בית ארז"), project("f", "מחסן תמר", "finished")] } as unknown as Dashboard);
    expect(screen.getByRole("button", { name: /שהסתיים/ })).toHaveTextContent("עוד פרויקט אחד שהסתיים");
  });
});
