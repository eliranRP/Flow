import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState, type ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { SettingsScreen } from "./flow-screens";
import {
  companyNameError,
  RENAME_CONTROL_CHAR,
  RENAME_FAILED,
  RENAME_REFUSED,
  RENAME_SAVED,
  RENAME_TOO_LONG,
  RENAME_TOO_SHORT,
  RENAME_UNDONE,
  RenameCompanySheet,
} from "./rename-company";

type Call = { name: string; args: unknown };

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter>{node}</MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function mockRpc(answer: (name: string, args: unknown) => { error: { message: string; code?: string } | null }) {
  const calls: Call[] = [];
  vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve({ data: null, ...answer(name, args) });
    },
  } as never);
  return calls;
}

function Harness({ blocked = () => false }: { blocked?: () => boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "open" : "closed"}</p>
      <RenameCompanySheet open={open} onOpenChange={setOpen} companyId="company-1" currentName="אלפא" blocked={blocked} />
    </>
  );
}

function FocusHarness() {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={row} onClick={() => { setOpen(true); }}>row</button>
      <RenameCompanySheet open={open} onOpenChange={setOpen} companyId="company-1" currentName="אלפא" blocked={() => false} returnFocusRef={row} />
    </>
  );
}

function field(): HTMLInputElement {
  return within(screen.getByRole("dialog", { name: "שם העסק" })).getByLabelText("שם");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("company name rules", () => {
  it("matches the RPC bounds after trimming", () => {
    expect(companyNameError(" א ")).toBe(RENAME_TOO_SHORT);
    expect(companyNameError("אב")).toBeUndefined();
    expect(companyNameError("א".repeat(100))).toBeUndefined();
    expect(companyNameError("א".repeat(101))).toBe(RENAME_TOO_LONG);
    expect(companyNameError("א".repeat(99) + "😀")).toBeUndefined();
  });

  it("refuses a control character after trimming, like private.company_name_problem (FLOW-606)", () => {
    // Trimmed away first, as private.trim_name does.
    expect(companyNameError("\tאלפא\n")).toBeUndefined();
    expect(companyNameError("\u00a0אלפא\ufeff")).toBeUndefined();
    // Inside the name: C0, DEL and C1.
    expect(companyNameError("אל\tפא")).toBe(RENAME_CONTROL_CHAR);
    expect(companyNameError("אל\u0001פא")).toBe(RENAME_CONTROL_CHAR);
    expect(companyNameError("אל\u007fפא")).toBe(RENAME_CONTROL_CHAR);
    expect(companyNameError("אל\u0085פא")).toBe(RENAME_CONTROL_CHAR);
    expect(companyNameError("אל\u009fפא")).toBe(RENAME_CONTROL_CHAR);
    // Next to the range, and the server's ordinary letters.
    expect(companyNameError("אל\u00a0פא")).toBeUndefined();
    expect(companyNameError("א״ב & Co.")).toBeUndefined();
    // The length rules come first, as on the server.
    expect(companyNameError("א\u0001")).toBe(RENAME_CONTROL_CHAR);
    expect(companyNameError("\u0001")).toBe(RENAME_TOO_SHORT);
    expect(companyNameError("א".repeat(100) + "\u0001")).toBe(RENAME_TOO_LONG);
  });
});

describe("rename company sheet", () => {
  it("saves the trimmed name, closes, and undoes back to the previous name", async () => {
    const calls = mockRpc(() => ({ error: null }));
    wrap(<Harness />);
    expect(field()).toHaveValue("אלפא");
    fireEvent.change(field(), { target: { value: "  בטא בע״מ  " } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await screen.findByText("closed");
    expect(calls).toEqual([{ name: "rename_company", args: { p_company_id: "company-1", p_name: "בטא בע״מ" } }]);
    expect(await screen.findByText(RENAME_SAVED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]).toEqual({ name: "rename_company", args: { p_company_id: "company-1", p_name: "אלפא" } });
    expect(await screen.findByText(RENAME_UNDONE)).toBeInTheDocument();
  });

  it("returns focus to the row after a save", async () => {
    mockRpc(() => ({ error: null }));
    wrap(<FocusHarness />);
    fireEvent.click(screen.getByRole("button", { name: "row" }));
    fireEvent.change(field(), { target: { value: "בטא" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await screen.findByText(RENAME_SAVED);
    await waitFor(() => { expect(screen.getByRole("button", { name: "row", hidden: true })).toHaveFocus(); });
  });

  it("refuses a too-short name on save and on blur, without calling the RPC", async () => {
    const calls = mockRpc(() => ({ error: null }));
    wrap(<Harness />);
    fireEvent.change(field(), { target: { value: " א " } });
    expect(field()).not.toHaveAttribute("aria-invalid");
    fireEvent.blur(field());
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(RENAME_TOO_SHORT)).toBeInTheDocument();
    fireEvent.change(field(), { target: { value: "א" } });
    expect(field()).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(screen.getByText(RENAME_TOO_SHORT)).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("refuses a pasted tab on the field instead of the save toast (FLOW-606)", async () => {
    const calls = mockRpc(() => ({ error: null }));
    wrap(<Harness />);
    fireEvent.change(field(), { target: { value: "בטא\tבע״מ" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(RENAME_CONTROL_CHAR)).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(screen.queryByText(RENAME_FAILED)).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("closes without a write when the name did not change", async () => {
    const calls = mockRpc(() => ({ error: null }));
    wrap(<Harness />);
    fireEvent.change(field(), { target: { value: " אלפא " } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await screen.findByText("closed");
    expect(calls).toHaveLength(0);
  });

  it("keeps the sheet and the typed name when the save fails", async () => {
    mockRpc(() => ({ error: { message: "boom" } }));
    wrap(<Harness />);
    fireEvent.change(field(), { target: { value: "בטא" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(RENAME_FAILED)).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(field()).toHaveValue("בטא");
    await waitFor(() => { expect(field()).toHaveFocus(); });
  });

  it("shows the refusal without a retry when the database says no", async () => {
    mockRpc(() => ({ error: { message: "not allowed", code: "42501" } }));
    wrap(<Harness />);
    fireEvent.change(field(), { target: { value: "בטא" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(RENAME_REFUSED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר", hidden: true })).not.toBeInTheDocument();
  });

  it("does not write when preview mode blocks the save", async () => {
    const calls = mockRpc(() => ({ error: null }));
    const blocked = vi.fn(() => true);
    wrap(<Harness blocked={blocked} />);
    fireEvent.change(field(), { target: { value: "בטא" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(blocked).toHaveBeenCalled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(calls).toHaveLength(0);
    expect(screen.getByText("open")).toBeInTheDocument();
  });
});

describe("settings business row", () => {
  const sample = { name: "אלפא", connected: false, companyId: null, lastError: null, email: "owner@example.com" };

  it("opens the rename sheet from the business row for an owner", () => {
    wrap(<SettingsScreen sample={sample} />);
    const row = screen.getByRole("button", { name: "שם העסק: אלפא" });
    fireEvent.click(row);
    const sheet = screen.getByRole("dialog", { name: "שם העסק" });
    expect(within(sheet).getByLabelText("שם")).toHaveValue("אלפא");
  });

  it("toasts instead of saving in a sample", async () => {
    const calls = mockRpc(() => ({ error: null }));
    wrap(<SettingsScreen sample={sample} />);
    fireEvent.click(screen.getByRole("button", { name: "שם העסק: אלפא" }));
    fireEvent.change(field(), { target: { value: "בטא" } });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    });
    expect(await screen.findByText("במצב תצוגה זה לא נשמר.")).toBeInTheDocument();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(calls).toHaveLength(0);
  });

  it("closes the rename sheet on browser Back and stays on Settings", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter([{ path: "*", element: <SettingsScreen sample={sample} /> }], { initialEntries: ["/", "/settings"], initialIndex: 1 });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <BooksProvider>
            <RouterProvider router={router} />
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "שם העסק: אלפא" }));
    expect(screen.getByRole("dialog", { name: "שם העסק" })).toBeInTheDocument();
    await waitFor(() => { expect(router.state.location.state).not.toBeNull(); });
    await act(async () => { await router.navigate(-1); });
    act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "שם העסק" })).not.toBeInTheDocument(); });
    expect(router.state.location.pathname).toBe("/settings");
  });

  it("keeps the business row static for a viewer", () => {
    wrap(
      <ViewerPreview>
        <SettingsScreen sample={sample} />
      </ViewerPreview>,
    );
    expect(screen.getByText("אלפא")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "שם העסק: אלפא" })).not.toBeInTheDocument();
    expect(screen.getByText("אלפא").closest("button")).toBeNull();
  });

  it("shows no business row without a company", () => {
    wrap(<SettingsScreen sample={{ ...sample, name: null, noCompany: true }} />);
    expect(screen.queryByRole("button", { name: /שם העסק/ })).not.toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
  });
});

type Answer = { error: { message: string; code?: string } | null };

function ReopenHarness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "open" : "closed"}</p>
      <button type="button" onClick={() => { setOpen(true); }}>reopen</button>
      <RenameCompanySheet open={open} onOpenChange={setOpen} companyId="company-1" currentName="אלפא" blocked={() => false} />
    </>
  );
}

function wrapReopen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter><ReopenHarness /></MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function mockPending(next: () => Promise<Answer>) {
  const calls: unknown[] = [];
  vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
    rpc: (_name: string, args: unknown) => {
      calls.push(args);
      return next().then((answer) => ({ data: null, ...answer }));
    },
  } as never);
  return calls;
}

describe("rename company sheet, busy, reopen and retry", () => {
  it("stays open on Escape while saving", async () => {
    let resolve: (answer: Answer) => void = () => undefined;
    mockPending(() => new Promise<Answer>((r) => { resolve = r; }));
    wrapReopen();
    fireEvent.change(field(), { target: { value: "בטא" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(field()).toBeDisabled(); });
    fireEvent.keyDown(field(), { key: "Escape" });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.getByText("open")).toBeInTheDocument();
    await act(async () => { resolve({ error: null }); await Promise.resolve(); });
    await screen.findByText("closed");
  });

  it("refills the current name when reopened after a discarded edit", async () => {
    mockPending(() => Promise.resolve({ error: null }));
    wrapReopen();
    fireEvent.change(field(), { target: { value: "בטא" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    await screen.findByText("closed");
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));
    await waitFor(() => { expect(field()).toHaveValue("אלפא"); });
  });

  it("closes and offers undo after ניסיון חוזר succeeds", async () => {
    const answers: Answer[] = [{ error: { message: "Failed to fetch" } }, { error: null }];
    const calls = mockPending(() => Promise.resolve(answers.shift() ?? { error: null }));
    wrapReopen();
    fireEvent.change(field(), { target: { value: "בטא" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    fireEvent.click(await screen.findByRole("button", { name: "ניסיון חוזר", hidden: true }));
    await screen.findByText("closed");
    expect(await screen.findByText(RENAME_SAVED)).toBeInTheDocument();
    expect(calls).toEqual([{ p_company_id: "company-1", p_name: "בטא" }, { p_company_id: "company-1", p_name: "בטא" }]);
  });
});
