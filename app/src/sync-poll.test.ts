import { describe, expect, it } from "vitest";
import { syncPollInterval } from "./use-books";

const at = (syncing: boolean | undefined, fetchFailureCount: number) => ({
  state: { data: syncing === undefined ? undefined : { syncing }, fetchFailureCount },
});

describe("syncPollInterval (FLOW-508)", () => {
  it("polls every 3s while a refresh runs", () => {
    expect(syncPollInterval(at(true, 0))).toBe(3000);
  });

  it("stops when the claim clears or there is no data", () => {
    expect(syncPollInterval(at(false, 0))).toBe(false);
    expect(syncPollInterval(at(undefined, 2))).toBe(false);
  });

  it("backs off on failing reads, up to a minute", () => {
    expect(syncPollInterval(at(true, 1))).toBe(6000);
    expect(syncPollInterval(at(true, 2))).toBe(12_000);
    expect(syncPollInterval(at(true, 5))).toBe(60_000);
    expect(syncPollInterval(at(true, 9))).toBe(60_000);
  });
});
