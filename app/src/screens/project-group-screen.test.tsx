import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GROUP_MISSING_TITLE, ProjectGroupScreen } from "./project-group-screen";
import { projectsGrouped } from "./project-groups-sample";
import { renderWithProviders } from "../test-render";

describe("project group page", () => {
  it("shows the standard empty state with a way back when the group is gone (FLOW-358)", () => {
    renderWithProviders(
      <ProjectGroupScreen sample={projectsGrouped} groupId="gone" />,
      { route: "/projects/groups/gone" },
    );
    expect(screen.getByText(GROUP_MISSING_TITLE)).toBeTruthy();
    // The empty state names what's missing, so no big title repeats it.
    expect(screen.queryByText("קבוצה")).toBeNull();
    expect(screen.getByRole("link", { name: "לכל הפרויקטים" }).getAttribute("href")).toBe("/projects");
  });
});
