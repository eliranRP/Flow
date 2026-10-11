import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpKind } from "../project-category-months";
import { categoryBack, ProjectCategoryScreen } from "./project-category-screen";
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

describe("the project category lines' basis (FLOW-404)", () => {
  it("reads the cash basis when the rehab list opens it", async () => {
    open("/projects/p1/categories/c1?period=all&basis=cash");
    await waitFor(() => { expect(basis()).toBe("cash"); });
  });

  it("counts on the company's basis otherwise (FLOW-103)", async () => {
    open("/projects/p1/categories/c1?period=all");
    await waitFor(() => { expect(rpc.calls.some((entry) => entry.name === "list_project_category")).toBe(true); });
    expect(basis()).toBeUndefined();
  });

  it("leaves out the usual month, which is on the books basis, on the cash basis", () => {
    const sample = { categoryName: "חומרים", projectName: "בית לדוגמה", rows: [], usual: { expected: 410_000n, up: null as UpKind } };
    open("/projects/p1/categories/c1?period=all&basis=cash", sample);
    expect(screen.queryByText(/בד״כ/)).not.toBeInTheDocument();
  });

  it("shows the usual month on the books basis", () => {
    const sample = { categoryName: "חומרים", projectName: "בית לדוגמה", rows: [], usual: { expected: 410_000n, up: null as UpKind } };
    open("/projects/p1/categories/c1?period=all", sample);
    expect(screen.getByText(/בד״כ/)).toBeInTheDocument();
  });
});

describe("Back from the project category lines", () => {
  it("returns to the screen the rehab sheet passed", () => {
    expect(categoryBack("p1", "", { back: "/projects/p1/investment?period=all" })).toBe("/projects/p1/investment?period=all");
  });

  it("falls back to the project page with the preview flag", () => {
    expect(categoryBack("p1", "?preview=1", null)).toBe("/projects/p1?preview=1");
  });

  it("ignores a passed path outside this project", () => {
    expect(categoryBack("p1", "", { back: "/projects/p2/investment" })).toBe("/projects/p1");
    expect(categoryBack("p1", "", { back: "https://example.test/" })).toBe("/projects/p1");
  });
});
