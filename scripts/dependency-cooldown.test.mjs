// FLOW-864: new dependency releases wait 3 days before Dependabot proposes them or pnpm resolves them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");

test("pnpm resolves no version younger than 3 days", () => {
  assert.match(read("pnpm-workspace.yaml"), /^minimumReleaseAge: 4320$/m);
});

test("every Dependabot ecosystem waits 3 days after a release", () => {
  const config = read(".github/dependabot.yml");
  const ecosystems = config.match(/^ {2}- package-ecosystem:/gm) ?? [];
  const cooldowns = config.match(/^ {4}cooldown:\n {6}default-days: 3$/gm) ?? [];
  assert.ok(ecosystems.length > 0);
  assert.equal(cooldowns.length, ecosystems.length);
});
