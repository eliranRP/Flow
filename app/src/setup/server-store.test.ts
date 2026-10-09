import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSetupServerForTests } from "./server-store";
import { emptySetupStore, loadSetupStore, readSetupStore, writeSetupStore } from "./storage";

const server = vi.hoisted(() => ({
  row: null as { state: unknown } | null,
  error: null as { message: string } | null,
  upserts: [] as { row: Record<string, unknown>; options: unknown }[],
  reads: 0,
}));

function readChain() {
  const next = {
    select: () => next,
    eq: () => next,
    maybeSingle: () => {
      server.reads += 1;
      return Promise.resolve({ data: server.row, error: server.error });
    },
  };
  return next;
}

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== "setup_states") throw new Error(`unexpected table ${table}`);
      return {
        ...readChain(),
        upsert: (row: Record<string, unknown>, options: unknown) => {
          server.upserts.push({ row, options });
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  }),
}));

const user = "user-506";
const company = "company-506";
const skippedTwo = { ...emptySetupStore(), run_started_at: "2026-10-09T00:00:00.000Z", skipped: { "2": "2026-10-09T00:01:00.000Z" } };

describe("setup flags on the server", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSetupServerForTests();
    server.row = null;
    server.error = null;
    server.upserts = [];
    server.reads = 0;
  });

  it("a new phone takes the server copy, without uploading it back", async () => {
    server.row = { state: skippedTwo };
    await loadSetupStore(user, company);
    expect(readSetupStore(user, company)).toEqual(skippedTwo);
    expect(server.upserts).toHaveLength(0);
  });

  it("uploads flags this phone kept before the server had a row", async () => {
    localStorage.setItem(`flow.setup.${user}.${company}`, JSON.stringify(skippedTwo));
    await loadSetupStore(user, company);
    expect(server.upserts).toHaveLength(1);
    expect(server.upserts[0]?.row).toMatchObject({ user_id: user, company_id: company, state: skippedTwo });
    expect(server.upserts[0]?.options).toEqual({ onConflict: "user_id,company_id" });
  });

  it("keeps a write made before the load settled over an older server copy", async () => {
    server.row = { state: { ...emptySetupStore(), run_started_at: "2026-10-01T00:00:00.000Z" } };
    writeSetupStore(user, company, skippedTwo);
    await loadSetupStore(user, company);
    expect(readSetupStore(user, company)).toEqual(skippedTwo);
    expect(server.upserts.at(-1)?.row).toMatchObject({ state: skippedTwo });
  });

  it("keeps the local copy when the read fails, and reads once per page load", async () => {
    localStorage.setItem(`flow.setup.${user}.${company}`, JSON.stringify(skippedTwo));
    server.error = { message: "offline" };
    await expect(loadSetupStore(user, company)).resolves.toBe(true);
    await loadSetupStore(user, company);
    expect(readSetupStore(user, company)).toEqual(skippedTwo);
    expect(server.reads).toBe(1);
    expect(server.upserts).toHaveLength(0);
  });

  it("after a failed read, a later write stays local and does not replace the row", async () => {
    server.error = { message: "offline" };
    await loadSetupStore(user, company);
    writeSetupStore(user, company, { ...emptySetupStore(), run_started_at: "2026-10-09T02:00:00.000Z" });
    expect(server.upserts).toHaveLength(0);
  });

  it("a new device with no row and no local flags uploads nothing", async () => {
    await loadSetupStore(user, company);
    expect(server.reads).toBe(1);
    expect(server.upserts).toHaveLength(0);
  });

  it("uploads every write once a company exists, and none before", () => {
    writeSetupStore(user, null, skippedTwo);
    expect(server.upserts).toHaveLength(0);
    writeSetupStore(user, company, skippedTwo);
    expect(server.upserts).toHaveLength(1);
  });
});
