import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LEDGER_KEYS } from "./ledger-keys";

/**
 * Reads no sync changes: the user's companies, team and invites, their settings, and the setup
 * run's own state (a sync during the setup flow must not reload the run under its steps). Their
 * own writes and screens refresh them.
 */
const ACCOUNT_KEYS = [
  "my-companies",
  "my-invites",
  "team",
  "notification-prefs",
  "mcp-status",
  "jev-key-status",
  "jev-integration",
  "setup-state",
  "setup-jev",
  "setup-loans",
  "setup-base-currency",
];

const root = `${import.meta.dirname}/`;

function appSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "dev" ? [] : appSources(path);
    if (!/\.tsx?$/.test(entry.name) || /\.(test|stories)\.tsx?$/.test(entry.name) || /(-sample|story-support|test-support)\./.test(entry.name)) return [];
    return [path];
  });
}

/** The first segment of every read's key in the app, by the source that names it. */
function readKeys(): Map<string, string> {
  const files = appSources(root).map((path) => ({ path: path.slice(root.length), text: readFileSync(path, "utf8") }));
  const all = files.map((file) => file.text).join("\n");
  const constant = (name: string) =>
    new RegExp(`const ${name}\\s*=\\s*\\[?\\s*"([^"]+)"`).exec(all)?.[1];
  const helper = (name: string) =>
    new RegExp(`function ${name}\\([^]*?\\[\\s*"([^"]+)"`).exec(all)?.[1];
  const keys = new Map<string, string>();
  for (const file of files) {
    for (const match of file.text.matchAll(/queryKey:\s*([^\n]+)/g)) {
      const expression = match[1] ?? "";
      const found = new Set<string>();
      const literal = /^\[\s*"([^"]+)"/.exec(expression)?.[1];
      if (literal) found.add(literal);
      const named = /^\[?\s*([A-Z][A-Z_]+)\b/.exec(expression)?.[1];
      if (named) {
        const value = constant(named);
        if (value) found.add(value);
      }
      for (const call of expression.matchAll(/\b(\w+Key)\(/g)) {
        const value = helper(call[1] ?? "");
        if (value) found.add(value);
      }
      // The key handed to cancel/refetch/invalidate is a filter, not a read.
      const line = file.text.slice(Math.max(0, match.index - 40), match.index);
      if (/(invalidate|cancel|remove|refetch|reset)Queries\(\{\s*$/.test(line)) continue;
      if (found.size === 0 && /^(key|readonly)\b/.test(expression)) continue;
      expect(found.size, `${file.path}: queryKey: ${expression}`).toBeGreaterThan(0);
      for (const key of found) keys.set(key, file.path);
    }
  }
  return keys;
}

describe("every read is refreshed by a finished sync or is an account read", () => {
  it("finds the reads it audits", () => {
    const keys = readKeys();
    for (const key of ["dashboard", "projects-cash", "loans", "recurring-schedule", "my-companies", "line-meta", "jev-connector"]) {
      expect(keys.has(key), key).toBe(true);
    }
  });

  it("lists each read's key in LEDGER_KEYS or the account reads", () => {
    const covered = new Set<string>([...LEDGER_KEYS, ...ACCOUNT_KEYS]);
    const missing = [...readKeys()].filter(([key]) => !covered.has(key)).map(([key, path]) => `${key} (${path})`);
    expect(missing).toEqual([]);
  });

  it("keeps no stale key in either list", () => {
    const keys = readKeys();
    expect([...LEDGER_KEYS, ...ACCOUNT_KEYS].filter((key) => !keys.has(key))).toEqual([]);
  });
});
