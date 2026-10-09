import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { ConnectionsScreen } from "./flow-screens";
import { connectorWord } from "./connections-status";

const expired = {
  name: "אלפא",
  connected: true,
  companyId: 1,
  lastError: "sumit_auth",
  email: "dana@example.com",
  mercuryConnected: true,
  mercuryLastError: "auth",
  assistant: { state: "expired" as const },
  jev: { enabled: false, mode: "shadow" as const, threshold: 0.9, status: "ready" as const },
};

function renderScreen(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/settings/connections"]}>{node}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("connector rows for a viewer (FLOW-507)", () => {
  it("an expired SUMIT or Mercury key reads neutral, like the AI row, with no warning tone", () => {
    renderScreen(
      <ViewerPreview>
        <ConnectionsScreen sample={expired} />
      </ViewerPreview>,
    );
    expect(screen.getAllByText("לא מחובר כרגע")).toHaveLength(3);
    expect(screen.queryByText("צריך לחבר מחדש")).not.toBeInTheDocument();
    expect(document.querySelector(".ui-row-tone-warning")).toBeNull();
  });

  it("an owner still sees צריך לחבר מחדש in the warning tone", () => {
    renderScreen(<ConnectionsScreen sample={expired} />);
    expect(screen.getAllByText("צריך לחבר מחדש").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelectorAll(".ui-row-tone-warning").length).toBeGreaterThanOrEqual(2);
  });

  it("names the read-only words", () => {
    expect(connectorWord("reconnect")).toBe("צריך לחבר מחדש");
    expect(connectorWord("reconnect", true)).toBe("לא מחובר");
    expect(connectorWord("reconnect", true, true)).toBe("לא מחובר כרגע");
    expect(connectorWord("connected", true, true)).toBe("מחובר");
  });
});
