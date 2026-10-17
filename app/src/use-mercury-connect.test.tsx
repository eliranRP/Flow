import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend, invokeEdge, resetBackend } from "./screens/connection-page-test-backend";
import { HookProviders } from "./screens/connection-page-test-support";
import { useMercuryConnect } from "./use-mercury-connect";

vi.mock("./lib/supabase", async () => (await import("./screens/connection-page-test-backend")).supabaseModule());
vi.mock("./edge", async () => (await import("./screens/connection-page-test-backend")).edgeModule());

afterEach(resetBackend);

const CONNECTED = "Mercury מחובר. המפתח נשאר בשרת.";
const DATE_LOST = "Mercury מחובר, אבל תאריך הייבוא לא נשמר.";
const KEY = "sample-token-12";

/** The key lives in the caller's state, as the page and the setup step keep it. */
function connectWith(importFrom?: string | null) {
  const onSuccess = vi.fn();
  const view = renderHook(() => {
    const [apiKey, setApiKey] = useState(KEY);
    const connect = useMercuryConnect({ apiKey, setApiKey, importFrom, onSuccess });
    return { apiKey, setApiKey, connect };
  }, { wrapper: HookProviders });
  return { ...view, onSuccess };
}

function importSaves() {
  return backend.args.filter(([name]) => name === "set_import_from").map(([, args]) => args);
}

describe("useMercuryConnect (FLOW-918)", () => {
  it("sends the trimmed key to mercury-connect and clears the field on failure and on success", async () => {
    invokeEdge.mockRejectedValueOnce(new Error("rejected")).mockResolvedValueOnce(undefined);
    const { result, onSuccess } = connectWith();
    act(() => { result.current.setApiKey(`  ${KEY} `); });
    act(() => { result.current.connect.mutate(); });
    await waitFor(() => { expect(invokeEdge).toHaveBeenCalledOnce(); });
    expect(invokeEdge.mock.calls[0]?.[0]).toBe("mercury-connect");
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ apiKey: KEY, importFrom: undefined });
    await waitFor(() => { expect(result.current.apiKey).toBe(""); });
    expect(onSuccess).not.toHaveBeenCalled();
    act(() => { result.current.setApiKey("another-token-99"); });
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(result.current.apiKey).toBe("");
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("saves ייבוא מ from here when the connect function does not report it", async () => {
    const { result } = connectWith("2026-01-01");
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(importSaves()).toEqual([{ p_provider: "mercury", p_from: "2026-01-01" }]);
    expect(invokeEdge).toHaveBeenCalledOnce();
  });

  it("sends ייבוא מ with the connect call so the first sync honours it", async () => {
    invokeEdge.mockResolvedValue({ connected: true, accounts: 1, import_from_saved: true });
    const { result } = connectWith("2026-01-01");
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ apiKey: KEY, importFrom: "2026-01-01" });
    expect(importSaves()).toEqual([]);
  });

  it("says the date was not saved when the connect function reports it failed", async () => {
    invokeEdge.mockResolvedValue({ connected: true, accounts: 1, import_from_saved: false });
    const { result, onSuccess } = connectWith("2026-01-01");
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(DATE_LOST)).toBeInTheDocument();
    expect(importSaves()).toEqual([]);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("leaves ייבוא מ alone when it was not changed", async () => {
    const { result } = connectWith(undefined);
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(importSaves()).toEqual([]);
  });

  it("saves מההתחלה (null) over a stored date when that is what was chosen", async () => {
    const { result } = connectWith(null);
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(importSaves()).toEqual([{ p_provider: "mercury", p_from: null }]);
  });

  it("does not save ייבוא מ when the connect fails", async () => {
    invokeEdge.mockRejectedValueOnce(new Error("auth"));
    const { result, onSuccess } = connectWith("2026-01-01");
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText("החיבור נכשל. בדקו את המפתח.")).toBeInTheDocument();
    expect(importSaves()).toEqual([]);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("still connects, and says so, when only saving ייבוא מ fails", async () => {
    const live = backend.answer;
    backend.answer = (name, args) => name === "set_import_from" ? Promise.resolve({ data: null, error: { message: "boom" } }) : live(name, args);
    const { result, onSuccess } = connectWith("2026-01-01");
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(DATE_LOST)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(result.current.apiKey).toBe("");
  });
});
