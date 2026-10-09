import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { ConnectionsScreen } from "./flow-screens";
import type { SettingsSample } from "./settings-screen";

// FLOW-507. The outer gate hides or disables the write controls for a viewer (viewer-writes.test.tsx).
// These cases reach an inner gate the outer one cannot: a deep link that asks for a connect sheet.
// Each has an owner control, so a broken fixture cannot pass for a held write.

const invoke = vi.hoisted(() => vi.fn());

vi.mock("../edge", async (original) => ({
  ...(await original<typeof import("../edge")>()),
  invokeEdge: invoke,
}));

const disconnected: SettingsSample = {
  name: "אלפא",
  connected: false,
  companyId: null,
  lastError: null,
  email: "dana@example.com",
  assistant: { state: "empty" },
  jev: { enabled: false, mode: "shadow", threshold: 0.9, status: "ready" },
};

function renderAt(node: ReactNode, path: string, asViewer: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={[path]}>{asViewer ? <ViewerPreview>{node}</ViewerPreview> : node}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  invoke.mockReset();
});

describe("viewer inner write gates", () => {
  it.each(["sumit", "mercury"])("a ?sheet=%s deep link opens the connect sheet for an owner", async (sheet) => {
    renderAt(<ConnectionsScreen sample={disconnected} />, `/settings/connections?sheet=${sheet}`, false);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it.each(["sumit", "mercury"])("a ?sheet=%s deep link opens nothing for a viewer", async (sheet) => {
    renderAt(<ConnectionsScreen sample={disconnected} />, `/settings/connections?sheet=${sheet}`, true);
    await expect(waitFor(() => { expect(screen.getByRole("dialog")).toBeInTheDocument(); }, { timeout: 300 })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
