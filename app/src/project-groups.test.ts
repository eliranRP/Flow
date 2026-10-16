import { describe, expect, it } from "vitest";
import { findGroup, groupHref, projectChoices, projectCountLabel } from "./project-groups";
import { projectsGrouped } from "./screens/project-groups-sample";
import { groupHint, groupSections, PICK_REST_HEADING } from "./ui/change-picker";

describe("project groups (FLOW-406)", () => {
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

  it("keeps the suggestion above the sections and two same-named groups apart", () => {
    const sections = groupSections(
      [
        { id: "s", name: "מוצע" },
        { id: "u1", name: "דירה 1", group: "בניין", groupId: "g1" },
        { id: "u2", name: "דירה 2", group: "בניין", groupId: "g2" },
      ],
      "s",
    );
    expect(sections?.map((section) => section.options.map((option) => option.id))).toEqual([["u1"], ["u2"]]);
  });

  it("names the group under a row only when the search matched through the group (FLOW-358)", () => {
    const unit = { id: "u1", name: "דירה 1", code: "P-7", group: "בניין לדוגמה", groupId: "g1" };
    expect(groupHint(unit, "לדוגמה")).toBe("בניין לדוגמה");
    expect(groupHint(unit, "דירה")).toBeUndefined();
    expect(groupHint(unit, "p-7")).toBeUndefined();
    expect(groupHint(unit, "")).toBeUndefined();
    expect(groupHint({ id: "a", name: "לדוגמה" }, "לדוגמה")).toBeUndefined();
  });
});
