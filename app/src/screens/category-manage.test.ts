import { describe, expect, it } from "vitest";
import { countCategoryLines, readDeleted, readMoved } from "./category-manage";

type Row = { id: string; category_id: string | null; removed_at: string | null; line_status: string };
type Part = { transaction_id: string; category_id: string };

/** A tiny stand-in for the PostgREST builder: eq, is, neq and in filter rows; awaiting it returns them. */
function fakeClient(lines: Row[], parts: Part[]) {
  function builder<T extends Record<string, unknown>>(rows: T[]) {
    let current = rows;
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => { current = current.filter((row) => row[column] === value); return chain; },
      is: (column: string, value: unknown) => { current = current.filter((row) => row[column] === value); return chain; },
      neq: (column: string, value: unknown) => { current = current.filter((row) => row[column] !== value); return chain; },
      in: (column: string, values: unknown[]) => { current = current.filter((row) => values.includes(row[column])); return chain; },
      then: (resolve: (value: { data: T[]; error: null }) => void) => { resolve({ data: current, error: null }); },
    };
    return chain;
  }
  return { from: (table: string) => (table === "transactions" ? builder(lines) : builder(parts)) } as never;
}

describe("category delete and move helpers (FLOW-405)", () => {
  it("counts whole lines and split lines once, without removed or void lines", async () => {
    const lines: Row[] = [
      { id: "a", category_id: "c1", removed_at: null, line_status: "open" },
      { id: "b", category_id: "c1", removed_at: "2026-10-01", line_status: "open" },
      { id: "c", category_id: "c1", removed_at: null, line_status: "void" },
      { id: "d", category_id: null, removed_at: null, line_status: "open" },
      { id: "e", category_id: null, removed_at: null, line_status: "void" },
      { id: "f", category_id: "c2", removed_at: null, line_status: "open" },
    ];
    const parts: Part[] = [
      { transaction_id: "d", category_id: "c1" },
      { transaction_id: "d", category_id: "c2" },
      { transaction_id: "e", category_id: "c1" },
      { transaction_id: "a", category_id: "c1" },
    ];
    await expect(countCategoryLines(fakeClient(lines, parts), "c1")).resolves.toBe(2);
    await expect(countCategoryLines(fakeClient(lines, parts), "c3")).resolves.toBe(0);
  });

  it("reads delete_category and move_category_lines results", () => {
    expect(readDeleted({ deletion_id: "x", name: "ציוד", lines: 3 }, "אחר")).toEqual({ name: "ציוד", lines: 3 });
    expect(readDeleted(null, "אחר")).toEqual({ name: "אחר", lines: 0 });
    expect(readMoved({ move_id: "m1", lines: 2 })).toEqual({ moveId: "m1", lines: 2 });
    expect(readMoved({ lines: 2 })).toBeNull();
  });
});
