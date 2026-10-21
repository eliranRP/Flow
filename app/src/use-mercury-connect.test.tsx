import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invokeEdge, resetBackend } from "./screens/connection-page-test-backend";
import { HookProviders } from "./screens/connection-page-test-support";
import { useMercuryConnect } from "./use-mercury-connect";

vi.mock("./lib/supabase", async () => (await import("./screens/connection-page-test-backend")).supabaseModule());
vi.mock("./edge", async () => (await import("./screens/connection-page-test-backend")).edgeModule());

afterEach(resetBackend);

const CONNECTED = "Mercury מחובר. המפתח נשאר בשרת.";
const KEY = "sample-token-12";

/** The key lives in the caller's state, as the page and the setup step keep it. */
function connectWith(slot?: number) {
  const onSuccess = vi.fn();
  const view = renderHook(() => {
    const [apiKey, setApiKey] = useState(KEY);
    const connect = useMercuryConnect({ apiKey, setApiKey, slot, onSuccess });
    return { apiKey, setApiKey, connect };
  }, { wrapper: HookProviders });
  return { ...view, onSuccess };
}

describe("useMercuryConnect (FLOW-918, FLOW-938)", () => {
  it("sends the trimmed key to mercury-connect and clears the field on failure and on success", async () => {
    invokeEdge.mockRejectedValueOnce(new Error("rejected")).mockResolvedValueOnce({ connected: true, slot: 1, choose_accounts: false });
    const { result, onSuccess } = connectWith();
    act(() => { result.current.setApiKey(`  ${KEY} `); });
    act(() => { result.current.connect.mutate(); });
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledOnce(); });
    expect(invokeEdge.mock.calls[0]?.[0]).toBe("mercury-connect");
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ apiKey: KEY });
    await waitFor(() => { expect(result.current.apiKey).toBe(""); });
    expect(onSuccess).not.toHaveBeenCalled();
    act(() => { result.current.setApiKey("another-token-99"); });
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(result.current.apiKey).toBe("");
    expect(onSuccess).toHaveBeenCalledWith({ slot: 1, chooseAccounts: false });
  });

  it("goes on to the accounts step without a toast when the connection's accounts are to be chosen", async () => {
    invokeEdge.mockResolvedValue({ connected: true, slot: 2, accounts: 5, choose_accounts: true });
    const { result, onSuccess } = connectWith();
    act(() => { result.current.connect.mutate(); });
    await waitFor(() => { expect(onSuccess).toHaveBeenCalledWith({ slot: 2, chooseAccounts: true }); });
    expect(screen.queryByText(CONNECTED)).not.toBeInTheDocument();
  });

  it("names the connection a replaced key is for", async () => {
    invokeEdge.mockResolvedValue({ connected: true, slot: 3, choose_accounts: false });
    const { result } = connectWith(3);
    act(() => { result.current.connect.mutate(); });
    await screen.findByText(CONNECTED);
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ apiKey: KEY, slot: 3 });
  });

  it("reads an older server's answer (no slot, no flag) as the one connection, connected", async () => {
    invokeEdge.mockResolvedValue({ connected: true, accounts: 3 });
    const { result, onSuccess } = connectWith();
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledWith({ slot: 1, chooseAccounts: false });
  });

  it("says in words when the key's accounts are already connected, or the key was refused", async () => {
    invokeEdge.mockRejectedValueOnce(new Error("already_connected")).mockRejectedValueOnce(new Error("auth"));
    const { result, onSuccess } = connectWith();
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText("החשבונות של המפתח הזה כבר מחוברים ב־Flow, בחיבור אחר.")).toBeInTheDocument();
    act(() => { result.current.setApiKey(KEY); });
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText("החיבור נכשל. בדקו את המפתח.")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
