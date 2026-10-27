import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as supabaseModule from "../lib/supabase";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { RolePreview, VIEWER_NOTE, ViewerPreview } from "../use-is-viewer";
import { BusinessScreen } from "./business-screen";
import {
  AFTER_DELETE_PATH,
  DANGER_HEAD,
  DELETE_CONFIRM,
  DELETE_DONE,
  DELETE_FIELD,
  DELETE_MISMATCH,
  DELETE_REFUSED,
  DELETE_ROW,
  DELETE_TITLE,
  deleteConfirmMatches,
  DeleteCompanySheet,
} from "./delete-company-sheet";

type Call = { name: string; args: unknown };

const NAME = "סטודיו אלפא";

function mockRpc(answer: () => { error: { message: string; code?: string } | null }) {
  const calls: Call[] = [];
  vi.spyOn(supabaseModule, "getSupabase").mockReturnValue({
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve({ data: null, ...answer() });
    },
  } as never);
  return calls;
}

function providers(client: QueryClient, node: ReactNode) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>{node}</BooksProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

function Harness({ blocked = () => false }: { blocked?: () => boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <p>{open ? "open" : "closed"}</p>
      <DeleteCompanySheet
        open={open}
        onOpenChange={setOpen}
        onLeave={() => { setOpen(false); }}
        companyId="company-1"
        companyName={NAME}
        blocked={blocked}
      />
    </>
  );
}

function renderSheet(client = newClient(), blocked?: () => boolean) {
  const router = createMemoryRouter(
    [
      { path: "/settings/business", element: <Harness blocked={blocked} /> },
      { path: AFTER_DELETE_PATH, element: <p>welcome</p> },
    ],
    { initialEntries: ["/settings/business"] },
  );
  render(providers(client, <RouterProvider router={router} />));
  return router;
}

function sheet() {
  return screen.getByRole("dialog", { name: DELETE_TITLE });
}

function confirmButton() {
  return within(sheet()).getByRole("button", { name: DELETE_CONFIRM });
}

function typeName(value: string) {
  fireEvent.change(within(sheet()).getByLabelText(DELETE_FIELD), { target: { value } });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteConfirmMatches", () => {
  it("matches the company name exactly after trimming, as delete_company checks", () => {
    expect(deleteConfirmMatches(NAME, NAME)).toBe(true);
    expect(deleteConfirmMatches(`  ${NAME} `, NAME)).toBe(true);
    expect(deleteConfirmMatches("סטודיו", NAME)).toBe(false);
    expect(deleteConfirmMatches("Alpha studio", "alpha studio")).toBe(false);
    expect(deleteConfirmMatches("", "")).toBe(false);
  });
});

describe("DeleteCompanySheet (decision 0194)", () => {
  it("says what goes and keeps the destructive button off until the name matches", () => {
    renderSheet();
    expect(within(sheet()).getByText(/הפרויקטים, התנועות, ההלוואות, החיבורים וההגדרות/)).toBeInTheDocument();
    expect(within(sheet()).getByText(/אי אפשר לבטל/)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    typeName("סטודיו");
    expect(confirmButton()).toBeDisabled();
    typeName(`${NAME} `);
    expect(confirmButton()).toBeEnabled();
    expect(confirmButton()).toHaveClass("ui-btn-signal");
  });

  it("deletes, clears every cached read and opens the welcome", async () => {
    const calls = mockRpc(() => ({ error: null }));
    const client = newClient();
    client.setQueryData(["dashboard"], { company_id: "company-1" });
    const router = renderSheet(client);
    typeName(` ${NAME}`);
    fireEvent.click(confirmButton());
    await waitFor(() => { expect(router.state.location.pathname).toBe(AFTER_DELETE_PATH); });
    expect(calls).toEqual([{ name: "delete_company", args: { p_company_id: "company-1", p_confirm: NAME } }]);
    expect(client.getQueryData(["dashboard"])).toBeUndefined();
    expect(await screen.findByText(DELETE_DONE)).toBeInTheDocument();
    // The data router renders a navigation in a transition: router.state moves at once, the page
    // after it, and the toast can show first under load (FLOW-981).
    expect(await screen.findByText("welcome")).toBeInTheDocument();
  });

  it("toasts a refusal for a user who is not the owner and stays open", async () => {
    mockRpc(() => ({ error: { message: "forbidden", code: "42501" } }));
    const router = renderSheet();
    typeName(NAME);
    fireEvent.click(confirmButton());
    expect(await screen.findByText(DELETE_REFUSED)).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/business");
  });

  it("shows the viewer note when the server finds no company this user may write", async () => {
    mockRpc(() => ({ error: { message: "no company", code: "P0001" } }));
    renderSheet();
    typeName(NAME);
    fireEvent.click(confirmButton());
    expect(await screen.findByText(VIEWER_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(DELETE_REFUSED)).not.toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("toasts a name the server does not accept", async () => {
    mockRpc(() => ({ error: { message: "confirmation_mismatch", code: "22023" } }));
    renderSheet();
    typeName(NAME);
    fireEvent.click(confirmButton());
    expect(await screen.findByText(DELETE_MISMATCH)).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("calls nothing when a preview blocks the write", async () => {
    const calls = mockRpc(() => ({ error: null }));
    const blocked = vi.fn(() => true);
    renderSheet(newClient(), blocked);
    typeName(NAME);
    fireEvent.click(confirmButton());
    expect(blocked).toHaveBeenCalled();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(calls).toHaveLength(0);
  });
});

describe("business page danger zone", () => {
  const sample = { name: NAME, connected: false, companyId: null, lastError: null, email: "owner@example.com" };

  function wrap(node: ReactNode) {
    return render(providers(newClient(), <MemoryRouter>{node}</MemoryRouter>));
  }

  it("shows the owner the danger zone, whose row opens the confirm", () => {
    wrap(<BusinessScreen sample={sample} />);
    expect(screen.getByRole("heading", { name: DANGER_HEAD })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: DELETE_ROW }));
    expect(screen.getByRole("dialog", { name: DELETE_TITLE })).toBeInTheDocument();
  });

  it("toasts instead of deleting in a sample", async () => {
    const calls = mockRpc(() => ({ error: null }));
    wrap(<BusinessScreen sample={sample} />);
    fireEvent.click(screen.getByRole("button", { name: DELETE_ROW }));
    typeName(NAME);
    fireEvent.click(confirmButton());
    expect(await screen.findByText("במצב תצוגה זה לא נשמר.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("hides the danger zone from an editor", () => {
    wrap(
      <RolePreview role="editor">
        <BusinessScreen sample={sample} />
      </RolePreview>,
    );
    expect(screen.queryByRole("heading", { name: DANGER_HEAD })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DELETE_ROW })).not.toBeInTheDocument();
  });

  it("hides the danger zone from a viewer", () => {
    wrap(
      <ViewerPreview>
        <BusinessScreen sample={sample} />
      </ViewerPreview>,
    );
    expect(screen.queryByRole("heading", { name: DANGER_HEAD })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DELETE_ROW })).not.toBeInTheDocument();
  });
});
