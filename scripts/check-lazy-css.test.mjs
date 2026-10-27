import assert from "node:assert/strict";
import test from "node:test";
import { dynamicTsxTargets, importsLazyCss, inHomeEntry } from "./check-lazy-css.mjs";

test("finds the .tsx modules a file loads with import(), not its CSS or .ts chunks", () => {
  const source = [
    'const Recurring = lazy(() => import("./screens/recurring-screen"));',
    'void import("./ui/sheet-drawer");',
    'import("./styles/app.css");',
    'import { x } from "./screens/home-screen";',
  ].join("\n");
  assert.deepEqual(dynamicTsxTargets("app/src/screen-loaders.ts", source), ["app/src/screens/recurring-screen.tsx"]);
});

test("a module imports lazy.css by a relative path on its own line", () => {
  assert.equal(importsLazyCss('import "../ui/lazy.css";\nimport { a } from "b";'), true);
  assert.equal(importsLazyCss('import "./lazy.css";'), true);
  assert.equal(importsLazyCss('// import "../ui/lazy.css";'), false);
  assert.equal(importsLazyCss('import "../ui/ui.css";'), false);
});

test("the sheet shell stays in Home's first load", () => {
  assert.equal(inHomeEntry.has("app/src/ui/sheet.tsx"), true);
});
