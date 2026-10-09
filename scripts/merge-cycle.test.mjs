import assert from "node:assert/strict";
import test from "node:test";
import { fetchRows, format, rowOf, sizeOf, summarize } from "./merge-cycle.mjs";

test("size classes follow the owner's targets", () => {
  assert.deepEqual(sizeOf(80, 4), { size: "S", target: 5 });
  assert.deepEqual(sizeOf(81, 1), { size: "M", target: 10 });
  assert.deepEqual(sizeOf(10, 5), { size: "M", target: 10 });
  assert.deepEqual(sizeOf(401, 2), { size: "L", target: 20 });
});

const pr = (number, minutes, lines, files = 2) => ({
  number,
  title: `PR ${number}`,
  additions: lines,
  deletions: 0,
  changed_files: files,
  created_at: "2026-10-09T10:00:00Z",
  merged_at: new Date(
    Date.parse("2026-10-09T10:00:00Z") + minutes * 60000,
  ).toISOString(),
  url: `pr/${number}`,
});

test("a row measures open to merge against the size's target", () => {
  const row = rowOf(pr(1, 7, 50));
  assert.equal(row.size, "S");
  assert.equal(row.minutes, 7);
  assert.equal(row.met, false);
  assert.equal(rowOf(pr(2, 9, 300)).met, true);
});

test("the summary counts met targets and medians per size", () => {
  const rows = [
    rowOf(pr(1, 3, 10)),
    rowOf(pr(2, 30, 200)),
    rowOf(pr(3, 8, 200)),
    rowOf(pr(4, 25, 900)),
  ];
  const summary = summarize(rows);
  assert.equal(summary.merged, 4);
  assert.equal(summary.met, 2);
  assert.deepEqual(summary.bySize.M, { merged: 2, met: 1, median: 8 });
  const text = format(rows);
  assert.match(
    text,
    /#2 M {3}200 lines {3}2 files {3}30 min \(target 10\) MISS PR 2/,
  );
  assert.match(text, /met target: 2\/4$/);
});

test("fetchRows keeps merged PRs since the cutoff and reads each one's counts", async () => {
  const calls = [];
  const get = async (url) => {
    calls.push(url);
    if (url.includes("/pulls?")) {
      if (url.endsWith("page=1")) {
        return [
          pr(3, 5, 10),
          { number: 9, url: "pr/9", merged_at: null },
          { ...pr(1, 5, 10), merged_at: "2026-10-09T09:00:00Z" },
        ];
      }
      return [];
    }
    return pr(Number(url.split("/").pop()), 5, 10);
  };
  const rows = await fetchRows({
    repo: "o/r",
    since: "2026-10-09T09:30:00Z",
    get,
  });
  assert.deepEqual(
    rows.map((row) => row.number),
    [3],
  );
  assert.ok(calls.includes("pr/3"));
  assert.ok(!calls.includes("pr/9"), "an unmerged PR is not fetched");
  assert.ok(
    !calls.includes("pr/1"),
    "a PR merged before the cutoff is not fetched",
  );
});
