import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "../App";

describe("component gallery", () => {
  it("is reachable and stays out of the production tab bar", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/dev/components"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "ספריית הרכיבים" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "ניווט ראשי" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "סרגל לשוניות, דוגמה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "מחיקה" })[0]).toHaveClass("ui-btn-danger");
  });
});
