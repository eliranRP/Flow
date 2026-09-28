import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "./categories.ts";

const migration = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20260927120000_schema_v1.sql",
  ),
  "utf8",
);

describe("default categories", () => {
  it("matches the names the schema trigger inserts", () => {
    const expense = [...migration.matchAll(/^\s+\(new\.id, '([^']+)', 'expense'/gm)].map(
      (match) => match[1],
    );
    const income = [...migration.matchAll(/^\s+\(new\.id, '([^']+)', 'income'/gm)].map(
      (match) => match[1],
    );
    expect(expense).toEqual([...DEFAULT_EXPENSE_CATEGORIES]);
    expect(income).toEqual([...DEFAULT_INCOME_CATEGORIES]);
  });
});
