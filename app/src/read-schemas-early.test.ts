import { QueryClient } from "@tanstack/react-query";
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { startHomeReads } from "./home-early-reads";

// FLOW-1273: the read schemas' chunk is requested when the first read goes out, so it is there when the first answer is parsed.
const seen = vi.hoisted(() => ({ events: [] as string[], release: null as null | (() => void) }));

vi.mock("./read-schemas", async (importOriginal) => {
  seen.events.push("schemas-import-started");
  return importOriginal<typeof import("./read-schemas")>();
});
vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: "t" } } }) },
    rpc: (name: string) => {
      seen.events.push(`rpc:${name}`);
      return new Promise((resolve) => { seen.release = () => { resolve({ data: null, error: null }); }; });
    },
  }),
}));
vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve() }));

describe("the read schemas load with the first read (FLOW-1273)", () => {
  it("has requested the schemas' chunk while the first read is still unanswered", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    startHomeReads(client, { pathname: "/", search: "" });
    await waitFor(() => { expect(seen.events.some((event) => event.startsWith("rpc:"))).toBe(true); });
    expect(seen.events).toContain("schemas-import-started");
    seen.release?.();
  });
});
