import { describe, expect, it } from "vitest";
import { syncPollInterval } from "./use-books";

const NOW = 1_000_000;
// data read `goodAgo` ms before NOW; the last failed read (if any) after it.
const at = (syncing: boolean | undefined, goodAgo: number, failed: boolean) => ({
  state: {
    data: syncing === undefined ? undefined : { syncing },
    dataUpdatedAt: NOW - goodAgo,
    errorUpdatedAt: failed ? NOW - 1 : 0,
  },
});

describe("syncPollInterval (FLOW-508)", () => {
  it("polls every 3s while a refresh runs", () => {
    expect(syncPollInterval(at(true, 3000, false), NOW)).toBe(3000);
  });

  it("stops when the claim clears or there is no data", () => {
    expect(syncPollInterval(at(false, 0, false), NOW)).toBe(false);
    expect(syncPollInterval(at(undefined, 0, true), NOW)).toBe(false);
  });

  it("backs off on failing reads by the time since the last good one, up to a minute", () => {
    expect(syncPollInterval(at(true, 1000, true), NOW)).toBe(3000);
    expect(syncPollInterval(at(true, 4000, true), NOW)).toBe(4000);
    expect(syncPollInterval(at(true, 8000, true), NOW)).toBe(8000);
    expect(syncPollInterval(at(true, 600_000, true), NOW)).toBe(60_000);
  });

  it("returns to 3s once a read succeeds again", () => {
    expect(syncPollInterval({ state: { data: { syncing: true }, dataUpdatedAt: NOW, errorUpdatedAt: NOW - 5000 } }, NOW))
      .toBe(3000);
  });
});
