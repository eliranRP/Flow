import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { StepSumit } from "./steps";

const invoke = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn((_name: string, _args?: unknown) => Promise.resolve({ data: null, error: null })));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    functions: { invoke },
    rpc,
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

  it("clears the API key after a successful connect and keeps the company number", async () => {
    const restore = reducedMotion();
    invoke.mockResolvedValue({ data: {}, error: null });
    render(<Harness onSkip={vi.fn()} onConnected={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "חיבור SUMIT" }));
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "חיבור SUMIT" }));
    const again = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    expect(within(again).getByLabelText("מפתח API")).toHaveValue("");
    expect(within(again).getByLabelText("מספר חברה")).toHaveValue("1001");
    restore();
  });

  it("saves ייבוא מ for SUMIT from here when the connect function does not report it (FLOW-505)", async () => {
    const restore = reducedMotion();
    invoke.mockResolvedValue({ data: {}, error: null });
    rpc.mockClear();
    const onConnected = vi.fn();
    render(<Harness onSkip={vi.fn()} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "חיבור SUMIT" }));
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "מתאריך" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => { expect(onConnected).toHaveBeenCalledOnce(); });
    const saved = rpc.mock.calls.find(([name]) => name === "set_import_from")?.[1] as { p_provider: string; p_from: string } | undefined;
    expect(saved?.p_provider).toBe("sumit");
    expect(saved?.p_from).toMatch(/^\d{4}-01-01$/);
    restore();
  });

  it("sends ייבוא מ with the SUMIT connect call so the first sync honours it", async () => {
    const restore = reducedMotion();
    invoke.mockClear();
    invoke.mockResolvedValue({ data: { connected: true, import_from_saved: true }, error: null });
    rpc.mockClear();
    const onConnected = vi.fn();
    render(<Harness onSkip={vi.fn()} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "חיבור SUMIT" }));
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "מתאריך" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => { expect(onConnected).toHaveBeenCalledOnce(); });
    const sent = invoke.mock.calls.find(([name]) => name === "sumit-connect")?.[1] as { body: { importFrom?: unknown } } | undefined;
    expect(sent?.body.importFrom).toMatch(/^\d{4}-01-01$/);
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("set_import_from");
    restore();
  });

  it("leaves ייבוא מ alone in setup when it was not touched", async () => {
    const restore = reducedMotion();
    invoke.mockResolvedValue({ data: {}, error: null });
    rpc.mockClear();
    const onConnected = vi.fn();
    render(<Harness onSkip={vi.fn()} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "חיבור SUMIT" }));
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => { expect(onConnected).toHaveBeenCalledOnce(); });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("set_import_from");
    restore();
  });

  it("still connects when only ייבוא מ fails to save", async () => {
    const restore = reducedMotion();
    invoke.mockResolvedValue({ data: {}, error: null });
    rpc.mockImplementationOnce(() => Promise.resolve({ data: null, error: { message: "boom" } as never }));
    const onConnected = vi.fn();
    render(<Harness onSkip={vi.fn()} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "חיבור SUMIT" }));
    const dialog = await screen.findByRole("dialog", { name: "חיבור SUMIT" });
    fireEvent.change(within(dialog).getByLabelText("מספר חברה"), { target: { value: "1001" } });
    fireEvent.change(within(dialog).getByLabelText("מפתח API"), { target: { value: "secret-key" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "מתאריך" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "חיבור" }));
    await waitFor(() => { expect(onConnected).toHaveBeenCalledOnce(); });
    expect(await screen.findByText("SUMIT מחובר, אבל תאריך הייבוא לא נשמר.")).toBeInTheDocument();
    restore();
  });
});
