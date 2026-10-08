import type { ProjectCategoryMonthRow, ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProjectCategories } from "./project-categories";

const project: NonNullable<ProjectDetail> = {
  id: "a",
  name: "פרויקט",
  status: "active",
  state_label: null,
  budget_agorot: null,
  income_agorot: 0n,
  direct_agorot: 0n,
  shared_agorot: 0n,
  profit_agorot: 0n,
  categories: [
    { id: "c1", name: "חומרים", amount_agorot: 786_000n },
    { id: "c3", name: "פינוי פסולת", amount_agorot: 195_000n },
    { id: "c5", name: "חשמל", amount_agorot: 45_500n },
    { id: "c6", name: "גז", amount_agorot: 15_500n },
  ],
  pending_count: 0,
  pending_agorot: 0n,
  transactions: [],
};

function month(id: string, flag: ProjectCategoryMonthRow["flag"]): ProjectCategoryMonthRow {
  return { id, name: id, group_name: null, currency: "ILS", this_month_minor: 0, months_minor: [], months_seen: 4, expected_minor: 9_000, typical_day: 10, flag };
}

function renderList() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProjectCategories
          project={project}
          search=""
          sampleGroups={{ c5: "חשבונות", c6: "חשבונות", c7: "חשבונות" }}
          sampleMonths={[month("c1", "high"), month("c3", "new"), month("c7", "missing")]}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("project categories list (FLOW-401)", () => {
  it("names each up mark by its flag", () => {
    renderList();
    expect(screen.getByRole("img", { name: "גבוה מהרגיל" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "חדש" })).toBeInTheDocument();
  });

  it("folds a group and opens it in place, with a bill not in yet", () => {
    renderList();
    const group = screen.getByRole("button", { name: /חשבונות/ });
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: /חשמל/ })).toBeNull();
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: /חשמל/ })).toBeInTheDocument();
    expect(screen.getByText("עוד לא הגיע")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^c7/ })).toBeNull();
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "false");
  });
});
