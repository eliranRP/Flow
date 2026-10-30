import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// FLOW-162: the report PDF's embedded fonts are the ones @fontsource/rubik ships.
test("report_fonts.ts matches @fontsource/rubik", () => {
  execFileSync(process.execPath, [path.join(root, "scripts/report-fonts.mjs"), "--check"], { stdio: "pipe" });
});
