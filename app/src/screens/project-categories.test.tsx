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

function renderList(months: ProjectCategoryMonthRow[] | null = [month("c1", "high"), month("c3", "new"), month("c7", "missing")]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProjectCategories
          project={project}
          search=""
          sampleGroups={{ c5: "חשבונות", c6: "חשבונות", c7: "חשבונות" }}
          sampleMonths={months ?? undefined}
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
    // The bill not in yet sits with the group's members, as "—" with its hidden word.
    const members = document.getElementById(group.getAttribute("aria-controls") ?? "");
    expect(members?.textContent).toContain("עוד לא הגיע");
    expect(members?.textContent).toContain("—");
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "false");
  });

  it("shows no marks and no bills not in yet without month rows (a longer period)", () => {
    renderList(null);
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /חשבונות/ }));
    expect(screen.queryByText("עוד לא הגיע")).toBeNull();
  });

  it("folds sub-categories under their parent, with the parent's own lines last (FLOW-406)", () => {
    const row = (id: string, name: string, parent_id: string | null = null) => ({ id, name, kind: "expense" as const, hidden: false, is_default: false, parent_id });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ProjectCategories
            project={{ ...project, categories: [...project.categories, { id: "c8", name: "תחזוקה", amount_agorot: 10_000n }] }}
            search=""
            sampleCategories={[row("c1", "חומרים"), row("c8", "תחזוקה"), row("c5", "חשמל", "c8"), row("c6", "גז", "c8")]}
            sampleMonths={[]}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const group = screen.getByRole("button", { name: /תחזוקה/ });
    // 455 + 155 + 100.
    expect(group).toHaveTextContent("₪710");
    fireEvent.click(group);
    const links = screen.getAllByRole("link").map((link) => link.textContent);
    const own = links.findIndex((text) => text.includes("בלי תת-קטגוריה"));
    expect(own).toBeGreaterThan(links.findIndex((text) => text.includes("חשמל")));
    expect(own).toBeGreaterThan(links.findIndex((text) => text.includes("גז")));
  });
});
