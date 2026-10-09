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

test("a row measures the last push to merge against the size's target", () => {
  const row = rowOf(pr(1, 7, 50));
  assert.equal(row.size, "S");
  assert.equal(row.from, "open");
  assert.equal(row.minutes, 7);
  assert.equal(row.met, false);
  assert.equal(rowOf(pr(2, 9, 300)).met, true);
  // A draft opened at claim time and pushed 3 minutes before the merge counts 3 minutes, not 60.
  const pushed = rowOf(pr(3, 60, 50), "2026-10-09T10:57:00Z");
  assert.equal(pushed.from, "push");
  assert.equal(pushed.minutes, 3);
  assert.equal(pushed.met, true);
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

test("fetchRows keeps merged PRs since the cutoff, reads each one's counts and last push, and pages by update time", async () => {
  const calls = [];
  const listed = (number, minutes, updatedAt, mergedAt) => ({
    ...pr(number, minutes, 10),
    updated_at: updatedAt,
    ...(mergedAt === undefined ? {} : { merged_at: mergedAt }),
  });
  const get = async (url) => {
    calls.push(url);
    if (url.includes("/pulls?")) {
      if (url.endsWith("page=1")) {
        return [
          // Merged at 09:00, before the cutoff, but commented on at 10:30: it must not stop the paging.
          listed(1, 5, "2026-10-09T10:30:00Z", "2026-10-09T09:00:00Z"),
          listed(3, 5, "2026-10-09T10:05:00Z"),
          listed(9, 5, "2026-10-09T10:04:00Z", null),
        ];
      }
      if (url.endsWith("page=2")) {
        return [
          listed(4, 5, "2026-10-09T10:03:00Z"),
          listed(2, 5, "2026-10-09T09:20:00Z", "2026-10-09T09:10:00Z"),
        ];
      }
      throw new Error(`page 3 must not be read: ${url}`);
    }
    if (url.includes("/commits/")) {
      return { commit: { committer: { date: "2026-10-09T10:03:00Z" } } };
    }
    const number = Number(url.split("/").pop());
    return { ...pr(number, 5, 10), head: { sha: `sha${number}` } };
  };
  const rows = await fetchRows({
    repo: "o/r",
    since: "2026-10-09T09:30:00Z",
    get,
  });
  assert.deepEqual(
    rows.map((row) => [row.number, row.from, row.minutes]),
    [
      [3, "push", 2],
      [4, "push", 2],
    ],
  );
  assert.ok(calls.includes("https://api.github.com/repos/o/r/commits/sha3"));
  assert.ok(!calls.includes("pr/9"), "an unmerged PR is not fetched");
  assert.ok(
    !calls.includes("pr/1"),
    "a PR merged before the cutoff is not fetched",
  );
});

test("fetchRows falls back to the open time when the head commit cannot be read", async () => {
  const get = async (url) => {
    if (url.includes("/pulls?"))
      return url.endsWith("page=1")
        ? [{ ...pr(5, 5, 10), updated_at: "2026-10-09T09:00:00Z" }]
        : [];
    if (url.includes("/commits/")) throw new Error("gone");
    return { ...pr(5, 5, 10), head: { sha: "sha5" } };
  };
  const rows = await fetchRows({
    repo: "o/r",
    since: "2026-10-09T08:00:00Z",
    get,
  });
  assert.deepEqual(
    rows.map((row) => [row.number, row.from, row.minutes]),
    [[5, "open", 5]],
  );
});
