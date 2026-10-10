import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { GROUP_MISSING_TITLE, ProjectGroupScreen } from "./project-group-screen";
import { projectsGrouped } from "./project-groups-sample";

describe("project group page", () => {
  it("shows the standard empty state with a way back when the group is gone (FLOW-358)", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BooksProvider>
          <MemoryRouter initialEntries={["/projects/groups/gone"]}>
            <ProjectGroupScreen sample={projectsGrouped} groupId="gone" />
          </MemoryRouter>
        </BooksProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(GROUP_MISSING_TITLE)).toBeTruthy();
    // The empty state names what's missing, so no big title repeats it.
    expect(screen.queryByText("קבוצה")).toBeNull();
    expect(screen.getByRole("link", { name: "לכל הפרויקטים" }).getAttribute("href")).toBe("/projects");
  });
});
