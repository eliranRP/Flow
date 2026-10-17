import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  boardFileName,
  mismatchPercent,
  parseArgs,
  proofFileName,
  proofPlan,
  readFrameMap,
} from "./board-proof.mjs";

test("parses the base, the map, the output folder, the board folder and the frames", () => {
  assert.deepEqual(
    parseArgs(["--base", "http://localhost:4173", "--map", "m.json", "--out", "proofs", "--boards", "b", "Flow"], {}),
    { base: "http://localhost:4173", map: "m.json", out: "proofs", boards: "b", frames: ["Flow"] },
  );
});

test("refuses a missing value, a missing required option, an unknown option and a frame with a path", () => {
  const env = { FLOW_BOARD_PNG: "b" };
  assert.throws(() => parseArgs(["--base", "--map", "m", "--out", "o"], env), /--base needs a value/);
  assert.throws(() => parseArgs(["--map", "m", "--out", "o"], env), /--base is required/);
  assert.throws(() => parseArgs(["--base", "b", "--out", "o"], env), /--map is required/);
  assert.throws(() => parseArgs(["--base", "b", "--map", "m"], env), /--out is required/);
  assert.throws(() => parseArgs(["--base", "b", "--map", "m", "--out", "o", "--width", "1"], env), /unknown option --width/);
  assert.throws(() => parseArgs(["--base", "b", "--map", "m", "--out", "o", "../x"], env), /not a frame name/);
});

test("takes the board folder from FLOW_BOARD_PNG when --boards is not given, and --boards wins", () => {
  assert.equal(parseArgs(["--base", "u", "--map", "m", "--out", "o"], { FLOW_BOARD_PNG: "env-boards" }).boards, "env-boards");
  assert.equal(parseArgs(["--base", "u", "--map", "m", "--out", "o", "--boards", "x"], { FLOW_BOARD_PNG: "env-boards" }).boards, "x");
});

test("refuses a run with neither --boards nor FLOW_BOARD_PNG, and says how to make the renders", () => {
  assert.throws(
    () => parseArgs(["--base", "u", "--map", "m", "--out", "o"], {}),
    /FLOW_BOARD_PNG[\s\S]*board-render\.mjs/,
  );
  // The four required-option checks still run first and keep their own messages.
  assert.throws(() => parseArgs(["--map", "m", "--out", "o"], {}), /--base is required/);
});

test("names the board file per theme: dark has no suffix, light has Light", () => {
  assert.equal(boardFileName("Flow", "dark"), "Flow.png");
  assert.equal(boardFileName("Flow", "light"), "FlowLight.png");
  assert.equal(proofFileName("LinesDetail", "light"), "LinesDetail--light.png");
});

test("reads a frame map and refuses a route that is not a path", () => {
  assert.deepEqual(readFrameMap({ Flow: "/?preview=1" }), { Flow: "/?preview=1" });
  assert.throws(() => readFrameMap(["Flow"]), /must be a JSON object/);
  assert.throws(() => readFrameMap({ Flow: "http://x" }), /must start with \//);
  assert.throws(() => readFrameMap({ "a/b": "/" }), /not a frame name/);
});

test("plans both themes for each frame, in name order, and keeps only the frames asked for", () => {
  const frames = { Lines: "/cash/2026-06/in/ILS", Flow: "/" };
  const boards = mkdtempSync(path.join(tmpdir(), "board-proof-"));
  for (const name of ["Flow.png", "FlowLight.png", "Lines.png", "LinesLight.png"]) writeFileSync(path.join(boards, name), "");
  const plan = proofPlan(frames, [], boards, "out");
  assert.deepEqual(
    plan.map((shot) => [shot.frame, shot.theme, shot.board, shot.file]),
    [
      ["Flow", "dark", path.join(boards, "Flow.png"), "out/Flow--dark.png"],
      ["Flow", "light", path.join(boards, "FlowLight.png"), "out/Flow--light.png"],
      ["Lines", "dark", path.join(boards, "Lines.png"), "out/Lines--dark.png"],
      ["Lines", "light", path.join(boards, "LinesLight.png"), "out/Lines--light.png"],
    ],
  );
  assert.deepEqual(
    proofPlan(frames, ["Flow"], boards, "out").map((shot) => shot.frame),
    ["Flow", "Flow"],
  );
  assert.throws(() => proofPlan(frames, ["Nope"], boards, "out"), /not in the frame map: Nope/);
  // A --boards folder with no board PNG for any requested frame fails, not an empty plan.
  assert.throws(() => proofPlan(frames, [], path.join(boards, "missing"), "out"), /no board PNG for/);
});

test("a theme with no board PNG gets no shot", () => {
  const boards = mkdtempSync(path.join(tmpdir(), "board-proof-"));
  writeFileSync(path.join(boards, "Lines.png"), "");
  const plan = proofPlan({ Lines: "/cash" }, [], boards, "out");
  assert.deepEqual(plan.map((shot) => shot.theme), ["dark"]);
});

test("counts a pixel as different when a channel is more than the tolerance apart", () => {
  const same = [10, 20, 30, 255, 10, 20, 30, 255];
  assert.equal(mismatchPercent(same, same, 16), 0);
  // The second pixel moves by 40 in one channel: half of the two pixels differ.
  const other = [10, 20, 30, 255, 10, 60, 30, 255];
  assert.equal(mismatchPercent(same, other, 16), 50);
  // A difference inside the tolerance is the same pixel.
  const near = [10, 20, 30, 255, 14, 20, 30, 255];
  assert.equal(mismatchPercent(same, near, 16), 0);
});

test("refuses two images of different sizes", () => {
  assert.throws(() => mismatchPercent([0, 0, 0, 255], [0, 0, 0, 255, 0, 0, 0, 255], 16), /differ in size/);
});
