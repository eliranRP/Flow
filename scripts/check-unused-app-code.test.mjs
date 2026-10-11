import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findUnused, isSupport } from "./check-unused-app-code.mjs";

/** @param {Record<string, string>} files  paths relative to the app root */
function withApp(files, run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "flow-unused-"));
  try {
    const all = {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "es2022", noEmit: true }, include: ["src", ".storybook/**/*.ts"] }),
      ...files,
    };
    for (const [name, text] of Object.entries(all)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), text);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("support files are named for it or listed", () => {
  assert.equal(isSupport("src/ui/button.stories.tsx"), true);
  assert.equal(isSupport("src/ui/story-support.tsx"), true);
  assert.equal(isSupport("src/screens/project-groups-sample.ts"), true);
  assert.equal(isSupport("src/team-test-harness.tsx"), true);
  assert.equal(isSupport("src/ui/index.ts"), true);
  assert.equal(isSupport("src/ui/button.tsx"), false);
  assert.equal(isSupport("src/latest.ts"), false);
});

test("a module only a story imports, and an export only a test uses, are reported", () => {
  const problems = withApp({
    "src/main.ts": 'import { used } from "./parts";\nvoid import("./lazy").then(({ load }) => load());\nused();\n',
    "src/parts.ts": "export function used(): void {}\nexport function onlyTested(): number { return 1; }\nexport function nowhere(): void {}\n",
    "src/parts.test.ts": 'import { onlyTested } from "./parts";\nonlyTested();\n',
    "src/lazy.ts": "export function load(): void {}\n",
    "src/old-card.ts": "export const oldCard = 1;\n",
    "src/old-card.stories.ts": 'import { oldCard } from "./old-card";\nexport const Story = oldCard;\n',
  }, (root) => findUnused({ appRoot: root, entry: "src/main.ts" }));
  assert.deepEqual(problems, [
    "src/old-card.ts: the app never imports it; only src/old-card.stories.ts do.",
    "src/parts.ts: onlyTested is used only by src/parts.test.ts.",
    "src/parts.ts: nowhere is used nowhere.",
  ]);
});

test("a test hook, a Storybook setup import and a sample module's exports may stay", () => {
  const problems = withApp({
    "src/main.ts": 'import { sample } from "./home-sample";\nimport { draw } from "./sheet";\ndraw(sample);\n',
    "src/sheet.ts": [
      "export function draw(_value: number): void {}",
      "export function resetSheetForTests(): void {}",
      "export function resetMemory(): void {}",
      "/**\n * Pins a role for a story.\n * @forTests\n */\nexport function RolePin(): void {}",
      "/** @forTests */\nexport const DURATION_MS = 10;",
      "export function primeDrawer(): void {}",
      "",
    ].join("\n"),
    ".storybook/preview.ts": 'import { primeDrawer } from "../src/sheet";\nprimeDrawer();\n',
    "src/home-sample.ts": "export const sample = 1;\nexport const storyOnly = 2;\n",
  }, (root) => findUnused({ appRoot: root, entry: "src/main.ts" }));
  assert.deepEqual(problems, []);
});
