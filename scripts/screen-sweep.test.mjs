import assert from "node:assert/strict";
import test from "node:test";
import { describeStuck, notReached } from "./screen-sweep.mjs";

const END = 10_000;

test("a run past the window names the skeletons still up, the reads not answered and the slowest", () => {
  const reads = [
    { name: "rpc/get_dashboard", start: 4_700, end: 8_900 },
    { name: "rpc/missing_bills", start: 5_200, end: null },
    { name: "loans", start: 9_000, end: 10_400 },
  ];
  const stuck = notReached({ drawn: true, skeletons: [".ui-skeleton-bar", "[aria-busy=true]"] }, reads, END);
  assert.deepEqual(stuck, { drawn: true, skeletons: [".ui-skeleton-bar", "[aria-busy=true]"], open: 2, slowest: { name: "rpc/missing_bills", ms: 4_800 } });
  assert.equal(
    describeStuck(stuck),
    "marker drawn, skeleton up (.ui-skeleton-bar, [aria-busy=true]), 2 reads unanswered at the window's end, slowest rpc/missing_bills 4,800 ms",
  );
});

test("a run with every read answered and no skeleton says the marker never matched", () => {
  const stuck = notReached({ drawn: false, skeletons: [] }, [{ name: "rpc/cash_months", start: 4_100, end: 4_700 }], END);
  assert.equal(describeStuck(stuck), "marker not drawn, no skeleton, 0 reads unanswered at the window's end, slowest rpc/cash_months 600 ms");
});

test("a run with no reads has no slowest", () => {
  assert.equal(describeStuck(notReached({ drawn: false, skeletons: [".ui-skel-row"] }, [], END)), "marker not drawn, skeleton up (.ui-skel-row), 0 reads unanswered at the window's end");
});
