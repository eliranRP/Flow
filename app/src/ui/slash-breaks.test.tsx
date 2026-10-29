import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { slashBreaks } from "./slash-breaks";

function html(text: string): string {
  return render(<span>{slashBreaks(text)}</span>).container.innerHTML;
}

describe("slashBreaks", () => {
  it("puts a break opportunity after each slash between letters", () => {
    expect(html("Partner – Contributions/Distributions")).toBe("<span>Partner – Contributions/<wbr>Distributions</span>");
    expect(html("a/b/c")).toBe("<span>a/<wbr>b/<wbr>c</span>");
    expect(html("הון/משיכות")).toBe("<span>הון/<wbr>משיכות</span>");
  });

  it("leaves a date, a lone slash and plain text as they are", () => {
    expect(slashBreaks("Bank")).toBe("Bank");
    expect(html("1/1/2026")).toBe("<span>1/1/2026</span>");
    expect(html("A / B")).toBe("<span>A / B</span>");
  });

  it("keeps the text the same", () => {
    expect(render(<span>{slashBreaks("Owner/Draws")}</span>).container.textContent).toBe("Owner/Draws");
  });
});
