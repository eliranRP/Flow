import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { StepSumit } from "./steps";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    functions: { invoke },
  }),
}));

function reducedMotion() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
  return () => {
    vi.unstubAllGlobals();
  };
}

function Harness({ onSkip, onConnected }: { onSkip: () => void; onConnected: () => void }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }));
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <StepSumit onSkip={onSkip} onConnected={onConnected} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("setup SUMIT connect", () => {
  it("keeps the typed values, toasts above the sheet, then offers ניסיון חוזר", async () => {
    const restore = reducedMotion();
    invoke.mockResolvedValue({ data: null, error: new Error("connect_failed") });
    const onSkip = vi.fn();
    const onConnected = vi.fn();
    render(<Harness onSkip={onSkip} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "חיבור SUMIT" }));
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    expect(await screen.findByText("לא הצלחנו להתחבר. נסו שוב.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("מספר חברה")).toHaveValue("1001");
    expect(within(dialog).getByLabelText("מפתח API")).toHaveValue("secret-key");
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({ body: { companyId: 1001, apiKey: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("SUMIT עוד לא מחובר.")).toBeInTheDocument();
    expect(screen.getByText("בודקים את מספר החברה ואת המפתח, ומנסים שוב.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    const again = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    expect(within(again).getByLabelText("מספר חברה")).toHaveValue("1001");
    expect(within(again).getByLabelText("מפתח API")).toHaveValue("secret-key");
    fireEvent.click(within(again).getByRole("button", { name: "סגירה" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    expect(onSkip).toHaveBeenCalledOnce();
    expect(onConnected).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledOnce();
    restore();
  });

  it("calls onConnected once after a successful connect", async () => {
    const restore = reducedMotion();
    invoke.mockResolvedValue({ data: {}, error: null });
    const onSkip = vi.fn();
    const onConnected = vi.fn();
    render(<Harness onSkip={onSkip} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "חיבור SUMIT" }));
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledOnce();
    });
    expect(invoke.mock.calls.length).toBeGreaterThanOrEqual(1);
    restore();
  });
});
