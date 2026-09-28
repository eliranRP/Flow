import assert from "node:assert/strict";
import test from "node:test";
import { violations } from "./check-prod-bundle.mjs";

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

test("flags the company id and the open-receivables total once they are inlined", () => {
  const found = violations({
    modules: ["/repo/app/src/main.tsx"],
    files: [{ name: "app/dist/assets/index.js", body: "134520 and 2389917160" }],
  });
  assert.equal(found.length, 2);
});
