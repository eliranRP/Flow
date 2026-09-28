import assert from "node:assert/strict";
import test from "node:test";
import { sourceViolations, violations } from "./check-prod-bundle.mjs";

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
    { name: "c.ts", body: "FLOW_TEST_WORKER_DAYS" },
    { name: "d.ts", body: "packages/shared/fixtures/demo-data.json" },
    { name: "e.ts", body: "expected-pnl" },
    { name: "f.ts", body: "demo-data" },
    { name: "g.ts", body: sentence },
  ]);
  for (const marker of ["flow-test", "2389917160", "FLOW_TEST_", "fixtures/", "expected-pnl", "demo-data", "fixture sentence"]) {
    assert.ok(found.some((line) => line.includes(marker)), marker);
  }
});

test("flags the company id and the open-receivables total once they are inlined", () => {
  const found = violations({
    modules: ["/repo/app/src/main.tsx"],
    files: [{ name: "app/dist/assets/index.js", body: "134520 and 2389917160" }],
  });
  assert.equal(found.length, 2);
});
