import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

const seen: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
const client = createClient("https://x.supabase.co", "anon", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: (input, init) => {
      seen.push({ url: typeof input === "string" ? input : "", signal: init?.signal });
      return Promise.resolve(new Response("[]", { headers: { "content-type": "application/json" } }));
    },
  },
});

vi.mock("./lib/supabase", () => ({ getSupabase: () => client }));
vi.mock("./load-read-schemas", () => ({ preloadReadSchemas: () => undefined }));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

const { readyClient } = await import("./ready-client");

describe("readyClient (FLOW-1348)", () => {
  beforeEach(() => {
    seen.length = 0;
  });

  it("with a signal, an rpc stops when the signal aborts, and a table read still works", async () => {
    const ac = new AbortController();
    const supabase = await readyClient({ signal: ac.signal });
    await supabase.rpc("list_unpaid" as never);
    await supabase.from("projects" as never).select("id");
    expect(seen).toHaveLength(2);
    // supabase-js hands fetch the signal it was given: aborting it aborts the request.
    expect(seen[0]?.signal?.aborted).toBe(false);
    ac.abort();
    expect(seen[0]?.signal?.aborted).toBe(true);
    expect(seen[1]?.signal?.aborted).toBeFalsy();
  });

  it("without a signal it is the client itself", async () => {
    expect(await readyClient()).toBe(client);
  });
});
