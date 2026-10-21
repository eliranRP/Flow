import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { BannerRow } from "../ui/banner";
import { AttentionBox } from "./home-parts";

// Owner report 2026-10-21: "$19 במקום $44 · חיוב קב…" was cut with plenty of room. The hint is one
// line, cut only when it does not fit, whether the box draws one row (a Banner) or several.
const changed: BannerRow = {
  id: "change:1",
  to: "/recurring",
  title: "הכנסה אחרת ירדה",
  hint: <><bdi dir="ltr">$19</bdi> במקום <bdi dir="ltr">$44</bdi> · חיוב קבוע</>,
};
const late: BannerRow = { id: "missing", to: "/recurring", title: "חשבון אחד לא הגיע" };

function hintStyle(rows: readonly BannerRow[]) {
  const { container, unmount } = render(
    <MemoryRouter>
      <AttentionBox rows={rows} />
    </MemoryRouter>,
  );
  const hint = container.querySelector(".ui-home-attention .ui-row-hint");
  expect(hint).not.toBeNull();
  const style = getComputedStyle(hint as Element);
  const result = { display: style.display, whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, overflow: style.overflow };
  unmount();
  return result;
}

describe("the דורש טיפול hint", () => {
  it.each([
    ["one row (a Banner)", [changed]],
    ["several rows", [late, changed]],
  ])("is one line with an ellipsis only at its end: %s", (_name, rows) => {
    expect(hintStyle(rows)).toEqual({ display: "block", whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" });
  });
});
