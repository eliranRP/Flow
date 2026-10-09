import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import type { UpKind } from "../project-category-months";
import { ProjectCategoryScreen } from "./project-category-screen";

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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/projects/:projectId/categories/:categoryId" element={<ProjectCategoryScreen sample={sample} />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
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

  it("keeps the books basis otherwise", async () => {
    open("/projects/p1/categories/c1?period=all");
    await waitFor(() => { expect(basis()).toBe("invoiced"); });
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
