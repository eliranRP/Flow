import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sampleDrift, SUMIT_ALLOWLIST } from "../../../supabase/functions/_shared/ledger.ts";

function files(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...files(full));
    else if (/\.(ts|tsx|sql|js|mjs)$/.test(name)) found.push(full);
  }
  return found;
}

describe("SUMIT read-only guard", () => {
  it("flags a CRM row that lost the amount field", () => {
    expect(
      sampleDrift([{ ID: 1, Accounting_DefinitionEnum: [], Accounting_DisplayCompanyValue: [10], Accounting_Date: ["2026-09-01"] }]),
    ).toEqual(["Accounting_DefinitionEnum"]);
  });

  it("allows only the read paths that appear in the repo", () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    const urls = new Set<string>();
    for (const file of files(root)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/https:\/\/api\.sumit\.co\.il\/[a-z0-9/_-]+/g)) {
        urls.add(match[0]);
      }
    }
    expect([...urls].sort()).toEqual([...SUMIT_ALLOWLIST].sort());
  });
});