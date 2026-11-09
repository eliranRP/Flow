import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SearchStart } from "./search-start";

const check = (key: string, count: number | null | undefined) => ({ key, title: key, hint: "", count, onPick: () => undefined });

describe("SearchStart's counts (FLOW-1139)", () => {
  it("draws a skeleton while a count is read, the number once it is in, and a blank when its read failed", () => {
    const { container } = render(
      <SearchStart recent={[]} onRecent={() => undefined} checks={[check("loading", null), check("ready", 7), check("failed", undefined)]} />,
    );
    const counts = [...container.querySelectorAll(".ui-search-check-count")];
    expect(counts).toHaveLength(3);
    expect(counts[0]?.querySelector(".ui-search-check-skel")).not.toBeNull();
    expect(counts[1]?.textContent).toBe("7");
    expect(counts[2]?.querySelector(".ui-search-check-skel")).toBeNull();
    expect(counts[2]?.textContent).toBe("");
  });
});
