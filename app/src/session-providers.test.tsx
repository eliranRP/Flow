import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProviders } from "./session-providers";
import { splitDraftKey } from "./split-drafts";
import { useToast } from "./ui/toast";

const auth = vi.hoisted(() => ({
  handlers: [] as Array<(event: string, session: Session | null) => void>,
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        auth.handlers.push(callback);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
  }),
}));

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LINE = "11111111-1111-4111-8111-111111111111";

function sessionFor(userId: string): Session {
  return { access_token: `token-${userId}`, user: { id: userId } } as unknown as Session;
}

function emit(event: string, session: Session | null) {
  act(() => {
    for (const handler of auth.handlers) handler(event, session);
  });
}

function UndoButton({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => { toast.show({ message: "שויך", action: "ביטול", onAction: onUndo }); }}>
      file
    </button>
  );
}

function renderApp(onUndo: () => void = () => undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SessionProviders>
        <UndoButton onUndo={onUndo} />
      </SessionProviders>
    </QueryClientProvider>,
  );
}

describe("a shared device: toasts and split drafts", () => {
  beforeEach(() => {
    auth.handlers.length = 0;
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("a user switch drops the last user's toast and its undo", () => {
    const onUndo = vi.fn();
    renderApp(onUndo);
    emit("INITIAL_SESSION", sessionFor(USER_A));
    fireEvent.click(screen.getByRole("button", { name: "file" }));
    expect(screen.getByText("שויך")).toBeInTheDocument();

    emit("SIGNED_IN", sessionFor(USER_B));

    expect(screen.queryByText("שויך")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ביטול" })).not.toBeInTheDocument();
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("a token refresh keeps the toast", () => {
    renderApp();
    emit("INITIAL_SESSION", sessionFor(USER_A));
    fireEvent.click(screen.getByRole("button", { name: "file" }));

    emit("TOKEN_REFRESHED", sessionFor(USER_A));

    expect(screen.getByText("שויך")).toBeInTheDocument();
  });

  it("sign-out in the same tab drops the unsaved split drafts", () => {
    renderApp();
    emit("INITIAL_SESSION", sessionFor(USER_A));
    sessionStorage.setItem(splitDraftKey(LINE), JSON.stringify({ method: "manual" }));
    sessionStorage.setItem("flow-sign-in-return", "/review");

    emit("SIGNED_OUT", null);

    expect(sessionStorage.getItem(splitDraftKey(LINE))).toBeNull();
    // Other tab state is not the split's to clear.
    expect(sessionStorage.getItem("flow-sign-in-return")).toBe("/review");
  });

  it("a user switch drops the drafts and a token refresh keeps them", () => {
    renderApp();
    emit("INITIAL_SESSION", sessionFor(USER_A));
    sessionStorage.setItem(splitDraftKey(LINE), "{}");

    emit("TOKEN_REFRESHED", sessionFor(USER_A));
    expect(sessionStorage.getItem(splitDraftKey(LINE))).toBe("{}");

    emit("SIGNED_IN", sessionFor(USER_B));
    expect(sessionStorage.getItem(splitDraftKey(LINE))).toBeNull();
  });

  it("a reload that finds another user (or none) drops the drafts", () => {
    renderApp();
    emit("INITIAL_SESSION", sessionFor(USER_A));
    sessionStorage.setItem(splitDraftKey(LINE), "{}");

    // A signed out in another tab, then this tab reloaded: no "previous" user here.
    auth.handlers.length = 0;
    renderApp();
    emit("INITIAL_SESSION", null);

    expect(sessionStorage.getItem(splitDraftKey(LINE))).toBeNull();
  });

  it("a reload by the same user keeps the drafts", () => {
    renderApp();
    emit("INITIAL_SESSION", sessionFor(USER_A));
    sessionStorage.setItem(splitDraftKey(LINE), "{}");

    auth.handlers.length = 0;
    renderApp();
    emit("INITIAL_SESSION", sessionFor(USER_A));

    expect(sessionStorage.getItem(splitDraftKey(LINE))).toBe("{}");
  });
});
