import { describe, expect, it } from "vitest";
import { JEV_REREAD_MS, rereadJevAfterSync, syncInserted } from "./jev-after-sync";

describe("Jev after a manual sync (FLOW-1027)", () => {
  it("reads the Jev suggestions again twice after a sync that stored lines", () => {
    const scheduled: Array<{ run: () => void; ms: number }> = [];
    const invalidated: string[][] = [];
    rereadJevAfterSync({ ok: true, inserted: 3 }, (key) => { invalidated.push([...key]); }, (run, ms) => { scheduled.push({ run, ms }); });
    expect(scheduled.map((item) => item.ms)).toEqual([...JEV_REREAD_MS]);
    expect(invalidated).toEqual([]);
    for (const item of scheduled) item.run();
    expect(invalidated).toEqual([["jev-review-queue"], ["jev-review"], ["jev-review-queue"], ["jev-review"]]);
  });

  it("does nothing after a sync with no new lines", () => {
    const scheduled: number[] = [];
    rereadJevAfterSync({ ok: true, inserted: 0, updated: 2 }, () => undefined, (_run, ms) => { scheduled.push(ms); });
    rereadJevAfterSync({ ok: true, skipped: true }, () => undefined, (_run, ms) => { scheduled.push(ms); });
    rereadJevAfterSync(null, () => undefined, (_run, ms) => { scheduled.push(ms); });
    expect(scheduled).toEqual([]);
    expect(syncInserted({ inserted: "3" })).toBe(false);
  });
});
