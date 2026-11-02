import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpKind } from "../project-category-months";
import { ProjectCategoryScreen } from "./project-category-screen";
import { renderWithProviders } from "../test-render";

type Call = { name: string; args: unknown };
const rpc = vi.hoisted(() => ({ calls: [] as Call[] }));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return new Promise(() => undefined);
    },
  }),
}));

afterEach(() => {
  rpc.calls = [];
});

function open(url: string, sample?: NonNullable<Parameters<typeof ProjectCategoryScreen>[0]>["sample"]) {
  renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId/categories/:categoryId" element={<ProjectCategoryScreen sample={sample} />} />
    </Routes>,
    { route: url },
  );
}

function basis(): unknown {
  const call = rpc.calls.find((entry) => entry.name === "list_project_category");
  return (call?.args as { p_basis?: unknown } | undefined)?.p_basis;
}

describe("the project category lines' basis", () => {
  it("counts on the company's basis (FLOW-103)", async () => {
    open("/projects/p1/categories/c1?period=all");
    await waitFor(() => { expect(rpc.calls.some((entry) => entry.name === "list_project_category")).toBe(true); });
    expect(basis()).toBeUndefined();
  });

  it("shows the usual month on the books basis", () => {
    const sample = { categoryName: "חומרים", projectName: "בית לדוגמה", rows: [], usual: { expected: 410_000n, up: null as UpKind } };
    open("/projects/p1/categories/c1?period=all", sample);
    expect(screen.getByText(/בד״כ/)).toBeInTheDocument();
  });
});
