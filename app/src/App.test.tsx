import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App", () => {
  it("shows the empty Home in preview, without a fake profit", () => {
    renderAt("/?preview=1");
    expect(screen.getByText("כאן יופיע הרווח הנקי של העסק")).toBeInTheDocument();
    expect(screen.getByText("עוד אין נתונים")).toBeInTheDocument();
    expect(screen.getByText("נתוני דוגמה · Example data")).toBeInTheDocument();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "בית" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "פרויקטים" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "הוספה" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "לאישור" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "הגדרות" })).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign-in", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: "כניסה או הרשמה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "המשך עם Google" })).toBeDisabled();
  });
});
