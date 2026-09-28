import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ProjectDetailScreen } from "./flow-screens";

describe("project overhead hero", () => {
  it("shows profit after the allocated share when the switch is on", () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/projects/a"]}>
            <Routes>
              <Route
                path="/projects/:projectId"
                element={
                  <ProjectDetailScreen
                    sample={{
                      id: "a",
                      name: "וילה רעננה",
                      status: "active",
                      state_label: "פעיל",
                      budget_agorot: null,
                      income_agorot: 90_000_000n,
                      direct_agorot: 72_000_000n,
                      shared_agorot: 6_000_000n,
                      profit_agorot: 18_000_000n,
                      after_overhead: true,
                      overhead_share_agorot: 0n,
                      overhead_weighted: false,
                      profit_after_overhead_agorot: 12_000_000n,
                      categories: [],
                      transactions: [],
                    }}
                  />
                }
              />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText("₪900,000")).toBeInTheDocument();
    expect(screen.getByText("₪780,000")).toBeInTheDocument();
    expect(screen.getByText("₪120,000")).toBeInTheDocument();
    expect(screen.queryByText("₪180,000")).not.toBeInTheDocument();
    expect(screen.getByText("דלוק · אין עדיין משקלות, החלק בכלליות הוא ₪0")).toBeInTheDocument();
  });
});
