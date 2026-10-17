import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend, invokeEdge, resetBackend } from "./screens/connection-page-backend";
import { HookProviders } from "./screens/connection-page-test-support";
import { useSumitConnect } from "./use-sumit-connect";

vi.mock("./lib/supabase", async () => (await import("./screens/connection-page-backend")).supabaseModule());
vi.mock("./edge", async () => (await import("./screens/connection-page-backend")).edgeModule());

afterEach(resetBackend);

const CONNECTED = "SUMIT מחובר. המפתח נשאר בשרת.";
const DATE_LOST = "SUMIT מחובר, אבל תאריך הייבוא לא נשמר.";
const KEY = "sample-key-123";

/** The company number and the key live in the caller's state, as the page keeps them. */
function connectWith(importFrom?: string | null) {
  const onSuccess = vi.fn();
  const view = renderHook(() => {
    const [apiKey, setApiKey] = useState(KEY);
    const connect = useSumitConnect({ companyId: "1234567", apiKey, setApiKey, importFrom, onSuccess });
    return { apiKey, connect };
  }, { wrapper: HookProviders });
  return { ...view, onSuccess };
}

function importSaves() {
  return backend.args.filter(([name]) => name === "set_import_from").map(([, args]) => args);
}

describe("useSumitConnect (FLOW-918)", () => {
  it("sends the company number as a number, keeps the key after a failure and clears it after a success", async () => {
    invokeEdge.mockRejectedValueOnce(new Error("sumit_auth")).mockResolvedValueOnce(undefined);
    const { result, onSuccess } = connectWith();
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText("החיבור נכשל. בדקו את המזהה ואת המפתח.")).toBeInTheDocument();
    expect(invokeEdge.mock.calls[0]?.[0]).toBe("sumit-connect");
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ companyId: 1234567, apiKey: KEY, importFrom: undefined });
    expect(result.current.apiKey).toBe(KEY);
    expect(onSuccess).not.toHaveBeenCalled();
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(result.current.apiKey).toBe("");
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("saves ייבוא מ from here when the connect function does not report it", async () => {
    const { result } = connectWith("2026-01-01");
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(importSaves()).toEqual([{ p_provider: "sumit", p_from: "2026-01-01" }]);
  });

  it("sends ייבוא מ with the connect call so the first sync honours it", async () => {
    invokeEdge.mockResolvedValue({ import_from_saved: true });
    const { result } = connectWith("2026-01-01");
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(CONNECTED)).toBeInTheDocument();
    expect(invokeEdge.mock.calls[0]?.[1]).toEqual({ companyId: 1234567, apiKey: KEY, importFrom: "2026-01-01" });
    expect(importSaves()).toEqual([]);
  });

  it("says the date was not saved when the connect function reports it failed", async () => {
    invokeEdge.mockResolvedValue({ import_from_saved: false });
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

  it("does not save ייבוא מ when the connect fails", async () => {
    invokeEdge.mockRejectedValueOnce(new Error("sumit_auth"));
    const { result } = connectWith("2026-01-01");
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText("החיבור נכשל. בדקו את המזהה ואת המפתח.")).toBeInTheDocument();
    expect(importSaves()).toEqual([]);
  });

  it("still connects, and says so, when only saving ייבוא מ fails", async () => {
    const live = backend.rpc;
    backend.rpc = (name, args) => name === "set_import_from" ? Promise.resolve({ data: null, error: { message: "boom" } }) : live(name, args);
    const { result, onSuccess } = connectWith("2026-01-01");
    act(() => { result.current.connect.mutate(); });
    expect(await screen.findByText(DATE_LOST)).toBeInTheDocument();
    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
