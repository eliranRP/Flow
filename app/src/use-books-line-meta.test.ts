import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LINE_META_MAX, lineMetaQueryKey, readLineMetaPage } from "./use-books";

const db = vi.hoisted(() => ({
  meta: [] as unknown,
  metaError: false,
  calls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      db.calls.push({ name, args });
      if (db.metaError) return Promise.resolve({ data: null, error: { message: "meta down" } });
      return Promise.resolve({ data: db.meta, error: null });
    },
  }),
}));

vi.mock("./wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve("x") }));

const empty = {
  transaction_id: "",
  method: null,
  card_last4: null,
  memo: null,
  account: null,
  counterparty: null,
  bank_description: null,
};

beforeEach(() => {
  db.meta = [];
  db.metaError = false;
  db.calls = [];
});

describe("readLineMetaPage (FLOW-315)", () => {
  it("reads past the server's 200-id cap in chunks, and caches only ids it read", async () => {
    expect(LINE_META_MAX).toBe(200);
    const ids = Array.from({ length: 450 }, (_, index) => `id-${String(index).padStart(3, "0")}`);
    db.meta = [{ ...empty, transaction_id: "id-420", method: "ach" }];
    const client = new QueryClient();
    const out = await readLineMetaPage(client, "off", ids);
    const asked = db.calls.filter((call) => call.name === "get_line_meta").map((call) => (call.args as { p_ids: string[] }).p_ids);
    expect(asked.map((chunk) => chunk.length)).toEqual([200, 200, 50]);
    expect(asked.flat()).toEqual(ids);
    expect(out.get("id-420")?.method).toBe("ach");
    expect(client.getQueryData(lineMetaQueryKey("off", "id-420"))).toMatchObject({ method: "ach" });
    expect(client.getQueryData(lineMetaQueryKey("off", "id-001"))).toBeNull();
  });

  it("caches nothing when a chunk fails", async () => {
    db.metaError = true;
    const client = new QueryClient();
    await expect(readLineMetaPage(client, "off", ["a", "b"])).rejects.toBeTruthy();
    expect(client.getQueryData(lineMetaQueryKey("off", "a"))).toBeUndefined();
  });
});
