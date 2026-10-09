import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { STARTER_SETS } from "./starter-categories.ts";

const migration = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20261013205829_starter_categories.sql",
  ),
  "utf8",
);

describe("starter category sets", () => {
  it("lists the same keys as private.starter_categories, in its order", () => {
    const keys = [
      ...new Set(
        [...migration.matchAll(/^\s+\('(\w+)', '[^']+', '(?:expense|income)'/gm)].map((m) => m[1]),
      ),
    ];
    expect(keys).toEqual(STARTER_SETS.map((set) => set.key));
  });

  it("names each set's label in the migration's comments", () => {
    for (const set of STARTER_SETS) expect(migration).toContain(`-- ${set.label}`);
  });
});
