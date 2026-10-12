import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, shotFileName, shotPlan, storyPath, SHOT_WIDTHS, THEME_NAMES } from "./story-shots.mjs";

test("parses the directory, the output folder and the story ids", () => {
  assert.deepEqual(parseArgs(["--dir", "app/storybook-static", "--out", "shots", "a--b", "c--d"]), {
    dir: "app/storybook-static",
    out: "shots",
    ids: ["a--b", "c--d"],
  });
});

test("refuses a missing value, a missing folder, an unknown option and no story", () => {
  assert.throws(() => parseArgs(["--dir", "--out", "shots", "a"]), /--dir needs a value/);
  assert.throws(() => parseArgs(["--out", "shots", "a"]), /--dir is required/);
  assert.throws(() => parseArgs(["--dir", "d", "a"]), /--out is required/);
  assert.throws(() => parseArgs(["--dir", "d", "--out", "o"]), /give at least one story id/);
  assert.throws(() => parseArgs(["--dir", "d", "--out", "o", "--width", "320", "a"]), /unknown option --width/);
  assert.throws(() => parseArgs(["--dir", "d", "--out", "o", "../../x"]), /not a story id/);
});

test("names each shot by story, theme and width", () => {
  assert.equal(shotFileName("ui-row--default", "dark", 393), "ui-row--default--dark-393.png");
});

test("plans every theme and width for each story, in order", () => {
  const plan = shotPlan(["s1"]);
  assert.deepEqual(
    plan.map((shot) => shot.file),
    ["s1--dark-320.png", "s1--dark-393.png", "s1--light-320.png", "s1--light-393.png"],
  );
  assert.deepEqual(THEME_NAMES, ["dark", "light"]);
  assert.deepEqual(SHOT_WIDTHS, [320, 393]);
});

test("puts the theme in the URL and never the width", () => {
  assert.equal(storyPath("ui-row--default", "light"), "/iframe.html?id=ui-row--default&viewMode=story&globals=theme:light");
  assert.doesNotMatch(storyPath("x", "dark"), /viewport|width/);
});
