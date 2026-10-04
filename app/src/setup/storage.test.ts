import { afterEach, describe, expect, it } from "vitest";
import { emptySetupStore, parseSetupStore, readSetupStore, setupStorageKey, writeSetupStore } from "./storage";

afterEach(() => {
  localStorage.clear();
});

describe("setup storage", () => {
  it("round-trips one store per user and company", () => {
    const store = { ...emptySetupStore(), run_started_at: "2026-10-04T00:00:00.000Z", skipped: { "2": "2026-10-04T00:00:00.000Z" } };
    writeSetupStore("user-a", "company-a", store);
    writeSetupStore("user-a", "company-b", emptySetupStore());
    expect(readSetupStore("user-a", "company-a")).toEqual(store);
    expect(readSetupStore("user-a", "company-b").run_started_at).toBeNull();
    expect(setupStorageKey("user-a", null)).toBe("flow.setup.user-a.none");
  });

  it("treats malformed JSON as an empty store and ignores a null user", () => {
    localStorage.setItem(setupStorageKey("user-a", "company-a"), "{");
    expect(readSetupStore("user-a", "company-a")).toEqual(emptySetupStore());
    expect(parseSetupStore("null")).toEqual(emptySetupStore());
    writeSetupStore(null, "company-a", { ...emptySetupStore(), run_started_at: "2026-10-04T00:00:00.000Z" });
    expect(localStorage.length).toBe(1);
  });
});
