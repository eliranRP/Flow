import assert from "node:assert/strict";
import test from "node:test";
import { hostedClientMarkers, reviewerNameViolations, sourceViolations, violations } from "./check-prod-bundle.mjs";
import { rejectEmptyHostedSupabase } from "./hosted-env.mjs";

test("flags a fixture module, a story, and a golden value", () => {
  const found = violations({
    modules: [
      "/repo/app/src/main.tsx",
      "/repo/app/src/fixtures/books.ts",
      "/repo/app/src/ui/button.stories.tsx",
      "/repo/packages/shared/src/testing.ts",
      "/repo/app/src/demo/model.ts",
    ],
    files: [{ name: "app/dist/assets/index.js", body: "const baked = 37700" }],
  });
  assert.ok(found.some((line) => line.includes("fixtures")));
  assert.ok(found.some((line) => line.includes("stories")));
  assert.ok(found.some((line) => line.includes("testing.ts")));
  assert.ok(found.some((line) => line.includes("/demo/")));
  assert.ok(found.some((line) => line.includes("37700")));
});

test("flags a dev route and a reviewer marker in the hosted bundle", () => {
  const found = violations({
    modules: ["/repo/app/src/reviewer-preview.tsx", "/repo/app/src/reviewer-sample.ts"],
    files: [{ name: "app/dist/assets/index.js", body: "route /e2e/project-detail sampleRun reviewerBooks reviewer-preview" }],
  });
  assert.ok(found.some((line) => line.includes("reviewer-preview")));
  assert.ok(found.some((line) => line.includes("reviewer-sample")));
  assert.ok(found.some((line) => line.includes("/e2e/")));
  assert.ok(found.some((line) => line.includes("sampleRun")));
  assert.ok(found.some((line) => line.includes("reviewerBooks")));
});

test("flags a Flow Test 2 name in the reviewer dist", () => {
  const found = reviewerNameViolations([
    { name: "app/dist/assets/reviewer.js", body: "שיפוץ הרצל 12 והובלות הגליל" },
  ], []);
  assert.ok(found.some((line) => line.includes("שיפוץ הרצל")));
  assert.ok(found.some((line) => line.includes("הובלות הגליל")));
  assert.deepEqual(reviewerNameViolations([
    { name: "app/dist/assets/reviewer.js", body: "בית הספר אלון" },
  ], []), []);
});

test("flags Flow Test 2 places, the plain crane name, golden ids, and the hosted client", () => {
  const places = reviewerNameViolations([
    { name: "app/dist/assets/reviewer.js", body: "פ״ת ת״א צבעי הגליל מנופי" },
  ], []);
  for (const name of ["פ״ת", "ת״א", "צבעי הגליל", "מנופי"]) {
    assert.ok(places.some((line) => line.includes(name)), name);
  }
  const golden = reviewerNameViolations([
    { name: "app/dist/assets/reviewer.js", body: "2389917160 37700" },
  ], []);
  assert.ok(golden.some((line) => line.includes("2389917160")));
  assert.ok(golden.some((line) => line.includes("37700")));
  const hosted = reviewerNameViolations([
    { name: "app/dist/assets/reviewer.js", body: "https://hosted.supabase.co eyJ-hosted-anon" },
  ], ["https://hosted.supabase.co", "eyJ-hosted-anon"]);
  assert.ok(hosted.some((line) => line.includes("hosted Supabase URL")));
  assert.ok(hosted.some((line) => line.includes("hosted Supabase anon key")));
  assert.equal(hostedClientMarkers().length, 2);
});

test("a hosted build rejects an empty Supabase URL or anon key", () => {
  assert.deepEqual(rejectEmptyHostedSupabase({ VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "key" }, false), [
    "VITE_SUPABASE_URL is set but empty",
  ]);
  assert.deepEqual(rejectEmptyHostedSupabase({ VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "" }, true), []);
  assert.deepEqual(rejectEmptyHostedSupabase({ VITE_SUPABASE_URL: "https://example.supabase.co" }, false), []);
});

test("accepts the production modules and a bundle without the golden totals", () => {
  const found = violations({
    modules: ["/repo/app/src/main.tsx", "/repo/packages/shared/src/money.ts", "/repo/app/src/screens/HomeScreen.tsx"],
    files: [{ name: "app/dist/assets/index.js", body: "formatIls" }],
  });
  assert.deepEqual(found, []);
});

test("flags demo-data and the fixture sentence in a built file", () => {
  const found = violations({
    modules: ["/repo/app/src/main.tsx"],
    files: [
      { name: "app/dist/assets/a.js", body: "import demo-data" },
      { name: "app/dist/assets/b.js", body: "שיפוץ דירה + לובי בבניין ברחוב הרצל 12, רמת גן. הלקוח העיקרי יזמות הגליל; ד.ל. נכסים (חברת הניהול) הזמינה תוספות בלובי." },
      { name: "app/dist/assets/c.js", body: "expected-pnl.json" },
    ],
  });
  assert.equal(found.length, 3);
});

test("flags each fixed-data marker in an Edge Function source", () => {
  const sentence =
    "שיפוץ דירה + לובי בבניין ברחוב הרצל 12, רמת גן. הלקוח העיקרי יזמות הגליל; ד.ל. נכסים (חברת הניהול) הזמינה תוספות בלובי.";
  const found = sourceViolations([
    { name: "a.ts", body: "import './flow-test.ts'" },
    { name: "b.ts", body: "const id = 2389917160" },
    { name: "b2.ts", body: "const id = 2393153301" },
    { name: "c.ts", body: "FLOW_TEST_WORKER_DAYS" },
    { name: "d.ts", body: "packages/shared/fixtures/demo-data.json" },
    { name: "e.ts", body: "expected-pnl" },
    { name: "f.ts", body: "demo-data" },
    { name: "g.ts", body: sentence },
  ]);
  for (const marker of ["flow-test", "2389917160", "2393153301", "FLOW_TEST_", "fixtures/", "expected-pnl", "demo-data", "fixture sentence"]) {
    assert.ok(found.some((line) => line.includes(marker)), marker);
  }
});

test("flags the company id and the open-receivables total once they are inlined", () => {
  const found = violations({
    modules: ["/repo/app/src/main.tsx"],
    files: [{ name: "app/dist/assets/index.js", body: "134520 and 2389917160 and 2393153301" }],
  });
  assert.equal(found.length, 3);
});

test("flags the Flow Test 2 folder, the open net, a draft id, and the fixture sentence", () => {
  const sentence = "Generated by `pnl.py` from `dataset.py` + `state.json`.";
  const found = violations({
    modules: ["/repo/app/src/main.tsx"],
    files: [{ name: "app/dist/assets/index.js", body: `2379562633 114000 draft:site ${sentence}` }],
  });
  assert.equal(found.length, 4);
  assert.ok(found.some((line) => line.includes("2379562633")));
  assert.ok(found.some((line) => line.includes("114000")));
  assert.ok(found.some((line) => line.includes("story id prefix")));
  assert.ok(found.some((line) => line.includes("fixture marker")));
  const sources = sourceViolations([
    { name: "a.ts", body: "2379562633" },
    { name: "b.ts", body: "114000" },
    { name: "c.ts", body: "draft:site" },
    { name: "d.ts", body: sentence },
  ]);
  for (const marker of ["2379562633", "114000", "draft:", "Flow Test 2 fixture"]) {
    assert.ok(sources.some((line) => line.includes(marker)), marker);
  }
});
