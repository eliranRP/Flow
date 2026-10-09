import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  LOAN_ESCROW_CATEGORY,
  LOAN_INTEREST_CATEGORY,
  LOAN_PRINCIPAL_CATEGORY,
} from "./categories.ts";

const migration = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20260928080538_schema_v1.sql",
  ),
  "utf8",
);

// 20261013171526 renames the first default income category (money terms glossary).
const incomeRename = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../supabase/migrations/20261013171526_default_income_category_name.sql",
  ),
  "utf8",
);

describe("default categories", () => {
  it("matches the names the schema trigger inserts", () => {
    const expense = [
      ...migration.matchAll(/^\s+\(new\.id, '([^']+)', 'expense'/gm),
    ].map((match) => match[1]);
    const [from, to] = [
      ...incomeRename.matchAll(/\(new\.id, '([^']+)', 'income', 1, true\)/g),
    ].map((match) => match[1]);
    const income = [
      ...migration.matchAll(/^\s+\(new\.id, '([^']+)', 'income'/gm),
    ].map((match) => (match[1] === from ? to : match[1]));
    expect(expense).toEqual([...DEFAULT_EXPENSE_CATEGORIES]);
    expect(income).toEqual([...DEFAULT_INCOME_CATEGORIES]);
  });

  it("seeds the loan split categories from the loans migration", () => {
    const loans = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../supabase/migrations/20261004055306_loans_l1.sql",
      ),
      "utf8",
    );
    expect(loans).toContain(
      `'${LOAN_INTEREST_CATEGORY}', 'expense', 10, true, false`,
    );
    expect(loans).toContain(
      `'${LOAN_ESCROW_CATEGORY}', 'expense', 11, true, false`,
    );
    expect(loans).toContain(
      `'${LOAN_PRINCIPAL_CATEGORY}', 'expense', 8, true, true`,
    );
  });
});
