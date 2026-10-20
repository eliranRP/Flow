import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "./auth";
import { notePushOwner } from "./push-owner";

// FLOW-516: an expired session keeps this browser's push subscription (iOS would not ask again);
// another user's sign-in drops it, even after a reload.

const auth = vi.hoisted(() => ({ handlers: [] as Array<(event: string, session: Session | null) => void> }));
const forget = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        auth.handlers.push(callback);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));
vi.mock("./push", () => ({ forgetThisDevice: forget }));

const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function session(userId: string): Session {
  return { access_token: `token-${userId}`, user: { id: userId } } as unknown as Session;
}

function emit(event: string, next: Session | null) {
  act(() => { for (const handler of auth.handlers) handler(event, next); });
}

beforeEach(() => {
  auth.handlers.length = 0;
  forget.mockClear();
  notePushOwner(null);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider><p>app</p></AuthProvider>
    </QueryClientProvider>,
  );
});

describe("this browser's push subscription across sessions", () => {
  it("stays when the session expires and the same user signs in again", async () => {
    notePushOwner(USER_A);
    emit("INITIAL_SESSION", session(USER_A));
    emit("SIGNED_OUT", null);
    emit("SIGNED_IN", session(USER_A));
    await Promise.resolve();
    expect(forget).not.toHaveBeenCalled();
  });

  it("goes when another user signs in, also after an expired session or a reload", async () => {
    notePushOwner(USER_A);
    emit("SIGNED_OUT", null);
    emit("SIGNED_IN", session(USER_B));
    await vi.waitFor(() => { expect(forget).toHaveBeenCalledTimes(1); });
  });

  it("does nothing when no subscription was saved here", async () => {
    emit("SIGNED_IN", session(USER_B));
    await Promise.resolve();
    expect(forget).not.toHaveBeenCalled();
  });
});
