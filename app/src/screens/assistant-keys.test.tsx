import { fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { SAMPLE_ASSISTANT_KEYS } from "../assistant-sample";
import { mintKey, restoreKey, revokeKey, TooManyKeys } from "./assistant-keys";
import { AiConnectionPage } from "./assistant-settings";

type Invoke = (name: string, options: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;
const calls: Array<{ name: string; body: unknown }> = [];
let respond: Invoke = () => Promise.resolve({ data: null, error: null });

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    functions: {
      invoke: (name: string, options: { body: unknown }) => {
        calls.push({ name, body: options.body });
        return respond(name, options);
      },
    },
    rpc: () => Promise.resolve({ data: { company_id: "co-1" }, error: null }),
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  }),
}));

beforeEach(() => {
  calls.length = 0;
  respond = () => Promise.resolve({ data: null, error: null });
});

describe("assistant key calls (FLOW-939)", () => {
  it("mints with the name and the assistant, and only reads the secret from the reply", async () => {
    respond = () => Promise.resolve({ data: { id: "k-1", secret: "flw_test_sample", scope: ["read"] }, error: null });
    const minted = await mintKey({ scope: "read", name: "Claude במחשב העבודה", client: "claude-code" });
    expect(minted.secret).toBe("flw_test_sample");
    expect(calls).toEqual([{ name: "flow-mcp/mint", body: { scope: "read", name: "Claude במחשב העבודה", client: "claude-code" } }]);
  });

  it("tells the cap apart from other mint failures", async () => {
    respond = () => Promise.resolve({ data: null, error: { context: new Response("{}", { status: 409 }) } });
    await expect(mintKey({ scope: "read", name: "x", client: "other" })).rejects.toBeInstanceOf(TooManyKeys);
    respond = () => Promise.resolve({ data: null, error: { context: new Response("{}", { status: 500 }) } });
    await expect(mintKey({ scope: "read", name: "x", client: "other" })).rejects.not.toBeInstanceOf(TooManyKeys);
  });

  it("revokes and restores one key by id", async () => {
    await revokeKey("k-1");
    await restoreKey("k-1");
    expect(calls).toEqual([
      { name: "flow-mcp/revoke", body: { id: "k-1" } },
      { name: "flow-mcp/restore", body: { id: "k-1" } },
    ]);
  });

  it("on the live page, revoking a key calls revoke and the toast's undo calls restore", async () => {
    let keys = SAMPLE_ASSISTANT_KEYS;
    respond = (name, options) => {
      if (name === "flow-mcp/status") return Promise.resolve({ data: { state: "connected", keys }, error: null });
      const id = (options.body as { id: string }).id;
      if (name === "flow-mcp/revoke") keys = keys.filter((key) => key.id !== id);
      if (name === "flow-mcp/restore") keys = SAMPLE_ASSISTANT_KEYS;
      return Promise.resolve({ data: { ok: true }, error: null });
    };
    renderWithProviders(<AiConnectionPage />, { route: "/settings/connections/ai/key/mcp-key-2" });
    fireEvent.click(await screen.findByRole("button", { name: "ביטול המפתח" }));
    expect(await screen.findByRole("heading", { name: "מפתחות פעילים · 1" })).toBeInTheDocument();
    const toast = await screen.findByText("המפתח בוטל · Claude.ai · טלפון");
    fireEvent.click(within(toast.closest(".ui-toast") ?? document.body).getByRole("button", { name: "ביטול" }));
    expect(await screen.findByRole("heading", { name: "מפתחות פעילים · 2" })).toBeInTheDocument();
    expect(calls.filter((call) => call.name !== "flow-mcp/status")).toEqual([
      { name: "flow-mcp/revoke", body: { id: "mcp-key-2" } },
      { name: "flow-mcp/restore", body: { id: "mcp-key-2" } },
    ]);
  });

  it("keeps the new code on screen when the first key joins the list, under /new as in the app's routes", async () => {
    vi.stubEnv("VITE_FLOW_MCP_URL", "https://mcp.example.test/mcp");
    let keys: typeof SAMPLE_ASSISTANT_KEYS = [];
    respond = (name) => {
      if (name === "flow-mcp/status") return Promise.resolve({ data: { state: keys.length ? "connected" : "empty", keys }, error: null });
      if (name === "flow-mcp/mint") {
        keys = [{
          id: "k-new",
          name: "Claude Code · מפתח 1",
          client: "claude-code",
          scope: ["read", "write"],
          created_at: "2026-10-20T08:00:00.000Z",
          last_used_at: null,
          expires_at: "2027-01-18T08:00:00.000Z",
          expired: false,
        }];
        return Promise.resolve({ data: { id: "k-new", secret: "flw_test_new_secret", scope: ["read", "write"] }, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    };
    renderWithProviders(
      <Routes>
        <Route path="/settings/connections/ai" element={<AiConnectionPage />} />
        <Route path="/settings/connections/ai/new" element={<AiConnectionPage />} />
        <Route path="/settings/connections/ai/key/:keyId" element={<AiConnectionPage />} />
      </Routes>,
      { route: "/settings/connections/ai" },
    );
    fireEvent.click(await screen.findByRole("button", { name: "יצירת קוד" }));
    const command = await screen.findByRole("textbox", { name: "פקודת חיבור" });
    expect((command as HTMLInputElement).value).toContain("flw_test_new_secret");
    expect(await screen.findByRole("link", { name: "כל המפתחות" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "פקודת חיבור" })).toBeInTheDocument();
    expect(calls.find((call) => call.name === "flow-mcp/mint")?.body).toEqual({ scope: "read_write", name: "Claude Code · מפתח 1", client: "claude-code" });
    fireEvent.click(screen.getByRole("button", { name: "סיום" }));
    expect(await screen.findByRole("heading", { name: "מפתחות פעילים · 1" })).toBeInTheDocument();
    expect(await screen.findByText("המפתח נוסף · מפתח פעיל אחד")).toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});
