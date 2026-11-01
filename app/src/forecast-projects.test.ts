import { describe, expect, it } from "vitest";
import { monthForecastBoardSample } from "./forecast-sample";
import { forecastProjects, GENERAL_NAME } from "./forecast-projects";

const sample = monthForecastBoardSample("project");
const build = sample.data.build;
const projects = sample.projects ?? [];

describe("forecastProjects (FLOW-1004)", () => {
  it("groups the counted items by project in the dashboard's order, the general costs last", () => {
    const groups = forecastProjects(build, projects);
    expect(groups.map((group) => group.name)).toEqual(["Northgate Co", "Elm St", GENERAL_NAME]);
    const elm = groups[1];
    expect(elm?.income.map((item) => item.name)).toEqual(["Elm St, unit 2"]);
    // Two of the small charges are Elm St's: they count under it, not under one small row.
    expect(elm?.expense.map((item) => item.name).sort()).toEqual(["Cloud storage", "Streaming"]);
    expect(elm?.net).toBe(165000n - 17400n);
  });

  it("adds up to the forecast's totals, and leaves the moved items out", () => {
    const groups = forecastProjects(build, projects);
    expect(groups.reduce((sum, group) => sum + group.incomeTotal, 0n)).toBe(build.incomeTotal);
    expect(groups.reduce((sum, group) => sum + group.expenseTotal, 0n)).toBe(build.expenseTotal);
    const moved = monthForecastBoardSample("changed").data.build;
    const keys = forecastProjects(moved, projects).flatMap((group) => [...group.income, ...group.expense].map((item) => item.key));
    expect(keys).not.toContain("invoice:inv-1043");
  });

  it("puts the overhead project's items under כללי, and an unknown project under its own name", () => {
    const overhead = forecastProjects(build, [{ id: "p-elm", name: "Elm St", is_overhead: true }]);
    expect(overhead.map((group) => group.name)).toEqual(["Northgate Co", GENERAL_NAME]);
    expect(overhead.at(-1)?.income.map((item) => item.name)).toContain("Elm St, unit 2");
    // Northgate Co is not in this list: its invoice keeps its own name, with no project to open.
    expect(overhead[0]?.projectId).toBeNull();
    expect(overhead.at(-1)?.projectId).toBeNull();
  });

  it("counts a charge on a project the list does not name as general, never a second כללי", () => {
    const groups = forecastProjects(build, [{ id: "p-north", name: "Northgate Co" }]);
    expect(groups.map((group) => group.name)).toEqual(["Northgate Co", GENERAL_NAME]);
    expect(groups.at(-1)?.income.map((item) => item.name)).toContain("Elm St, unit 2");
  });

  it("has no כללי section when every item has a project", () => {
    const none = forecastProjects({ ...build, income: [], expense: [], small: build.small.filter((item) => item.project_id === "p-elm") }, projects);
    expect(none.map((group) => group.name)).toEqual(["Elm St"]);
  });
});
