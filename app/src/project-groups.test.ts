import { describe, expect, it } from "vitest";
import { findGroup, groupHref, projectChoices, projectCountLabel, splitByGroup } from "./project-groups";
import { projectsGrouped } from "./screens/project-groups-sample";
import { groupSections, PICK_REST_HEADING } from "./ui/change-picker";

describe("project groups (FLOW-406)", () => {
  it("lifts grouped projects out of the top level and keeps the rest loose", () => {
    const split = splitByGroup(projectsGrouped);
    expect(split.groups.map((entry) => entry.group.name)).toEqual(["בניין לדוגמה"]);
    expect(split.groups[0]?.projects.map((project) => project.id)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(split.loose.map((project) => project.id)).toEqual(["a", "b", "f1", "f2"]);
  });

  it("orders groups by sort order, leaves out empty ones, and treats an unknown group as none", () => {
    const base = projectsGrouped.groups?.[0];
    const row = projectsGrouped.projects[0];
    if (base == null || row == null) throw new Error("sample has a group");
    const split = splitByGroup({
      projects: [
        { ...row, id: "x", group_id: "late" },
        { ...row, id: "y", group_id: "early" },
        { ...row, id: "z", group_id: "gone" },
      ],
      groups: [
        { ...base, id: "late", name: "ב", sort_order: 2 },
        { ...base, id: "early", name: "א", sort_order: 1 },
        { ...base, id: "empty", name: "ג", sort_order: 0 },
      ],
    });
    expect(split.groups.map((entry) => entry.group.id)).toEqual(["early", "late"]);
    expect(split.loose.map((project) => project.id)).toEqual(["z"]);
  });

  it("finds one group with its projects, or null", () => {
    expect(findGroup(projectsGrouped, "g1")?.projects).toHaveLength(4);
    expect(findGroup(projectsGrouped, "gone")).toBeNull();
    expect(findGroup({ projects: projectsGrouped.projects }, "g1")).toBeNull();
  });

  it("gives each picker choice its group's name", () => {
    const choices = projectChoices(projectsGrouped);
    expect(choices.find((choice) => choice.id === "u1")?.group).toBe("בניין לדוגמה");
    expect(choices.find((choice) => choice.id === "a")).not.toHaveProperty("group");
    expect(projectChoices(undefined)).toEqual([]);
  });

  it("counts projects and links a group", () => {
    expect(projectCountLabel(1)).toBe("פרויקט אחד");
    expect(projectCountLabel(4)).toBe("4 פרויקטים");
    expect(groupHref("g 1", "?period=3m")).toBe("/projects/groups/g%201?period=3m");
  });

  it("sections the picker by group, then the rest, and not at all with no groups", () => {
    const sections = groupSections([
      { id: "a", name: "א" },
      { id: "u1", name: "דירה 1", group: "בניין" },
      { id: "u2", name: "דירה 2", group: "בניין" },
    ]);
    expect(sections?.map((section) => section.heading)).toEqual(["בניין", PICK_REST_HEADING]);
    expect(sections?.[0]?.options.map((option) => option.id)).toEqual(["u1", "u2"]);
    expect(groupSections([{ id: "a", name: "א" }])).toBeNull();
  });
});
