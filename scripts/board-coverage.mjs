#!/usr/bin/env node
/**
 * Lists the board's ready and light artboards (their frames) that no proof map names yet. The maps are the
 * design/proof/<area>-map.json files: { "<Frame>": "<route>" }, one file per area. A frame in no map has no
 * board-proof gate, so it is listed as missing. The report is informative: it exits 0 whatever it finds.
 *
 * Usage: node scripts/board-coverage.mjs --project <board project dir> [--maps design/proof]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { frameOf, selectBoards } from "./board-render.mjs";

const DEFAULT_MAPS = "design/proof";
const MAP_SUFFIX = "-map.json";

/**
 * @param {string[]} argv the arguments after the script name
 * @returns {{ project: string, maps: string }}
 */
export function parseArgs(argv) {
  const options = { project: "", maps: DEFAULT_MAPS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project" || arg === "--maps") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--project") options.project = value;
      else options.maps = value;
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (options.project === "") throw new Error("--project is required (the board project folder)");
  return options;
}

/**
 * @param {{ pages?: Array<{ id: string }>, boards?: Record<string, { page?: string }> }} canvas the parsed canvas.json
 * @param {Record<string, Record<string, string>>} maps the proof maps, keyed by file name
 * @returns {{ frames: string[], mapped: string[], missing: string[], stale: string[], duplicates: string[] }}
 */
export function coverage(canvas, maps) {
  const frames = [...new Set(selectBoards(canvas).map((board) => frameOf(board.name)))].sort();
  const frameSet = new Set(frames);
  /** @type {Map<string, number>} how many map files name each frame */
  const counts = new Map();
  const named = new Set();
  for (const map of Object.values(maps)) {
    for (const frame of Object.keys(map)) named.add(frame);
    // A frame counts once per map file, so a map that lists a frame twice is not a duplicate of itself.
    for (const frame of new Set(Object.keys(map))) counts.set(frame, (counts.get(frame) ?? 0) + 1);
  }
  return {
    frames,
    mapped: frames.filter((frame) => named.has(frame)),
    missing: frames.filter((frame) => !named.has(frame)),
    stale: [...named].filter((frame) => !frameSet.has(frame)).sort(),
    duplicates: frames.filter((frame) => (counts.get(frame) ?? 0) > 1),
  };
}

/**
 * @param {string} dir the folder of map files
 * @returns {Record<string, Record<string, string>>} each *-map.json in name order, keyed by its file name
 */
export function readMaps(dir) {
  const maps = /** @type {Record<string, Record<string, string>>} */ ({});
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(MAP_SUFFIX))
    .sort();
  for (const file of files) {
    const map = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    if (map === null || typeof map !== "object" || Array.isArray(map)) throw new Error(`the frame map ${file} must be a JSON object`);
    maps[file] = map;
  }
  return maps;
}

/**
 * @param {ReturnType<typeof coverage>} result
 * @returns {string} the report: the counts, the missing frames, then the stale and duplicate frames when there are any
 */
export function report(result) {
  const lines = [`board frames: ${result.frames.length}, mapped: ${result.mapped.length}, missing: ${result.missing.length}`];
  lines.push("missing:", ...result.missing.map((frame) => `  ${frame}`));
  if (result.stale.length > 0) lines.push("stale:", ...result.stale.map((frame) => `  ${frame}`));
  if (result.duplicates.length > 0) lines.push("duplicates:", ...result.duplicates.map((frame) => `  ${frame}`));
  return `${lines.join("\n")}\n`;
}

/** Prints the report. A bad argument or an unreadable canvas or map is an error; the report itself never is. */
function main(argv) {
  const options = parseArgs(argv);
  const canvas = JSON.parse(readFileSync(path.join(options.project, "canvas.json"), "utf8"));
  const maps = readMaps(options.maps);
  process.stdout.write(report(coverage(canvas, maps)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
