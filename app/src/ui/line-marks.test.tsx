import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { KeptOutTag, lineTagText, rowSource } from "./line-marks";
import { ListRow } from "./list-row";

describe("line marks on transaction rows (FLOW-124, FLOW-125)", () => {
  it("shows a bank line with the bank icon and every other source as a document", () => {
    expect(rowSource("mercury")).toBe("bank");
    expect(rowSource("sumit")).toBe("invoice");
    expect(rowSource("manual")).toBe("invoice");
    expect(rowSource(undefined)).toBe("invoice");
  });

  it("names the ⊘ on a row out of the P&L", () => {
    render(
      <MemoryRouter>
        <ListRow variant="transaction" title="ריבית" agorot={-41_200n} sign="out" source={rowSource("sumit")} tag={<KeptOutTag label="לא נספר ברווח" />} href="/transactions/t2" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("img", { name: "לא נספר ברווח" })).toBeInTheDocument();
  });
});

describe("lineTagText (FLOW-366)", () => {
  it("is null when the line is neither pending nor out of profit", () => {
    expect(lineTagText({ pending: false, inPnl: true, reason: "חומרים" })).toBeNull();
  });

  it("names a pending line", () => {
    const { container } = render(<span>{lineTagText({ pending: true, inPnl: true, reason: null })}</span>);
    expect(container).toHaveTextContent("ממתין לאישור");
    expect(container).not.toHaveTextContent("לא נספר ברווח");
  });

  it("names the reason and the out-of-profit mark, and joins pending first", () => {
    const { container } = render(<span>{lineTagText({ pending: true, inPnl: false, reason: "קרן הלוואה" })}</span>);
    expect(container).toHaveTextContent("ממתין לאישור · קרן הלוואה · לא נספר ברווח");
    expect(container.querySelector(".ui-tag-aside")).toHaveTextContent("קרן הלוואה · לא נספר ברווח");
  });

  it("drops the reason when there is none", () => {
    const { container } = render(<span>{lineTagText({ pending: false, inPnl: false, reason: null })}</span>);
    expect(container.querySelector(".ui-tag-aside")).toHaveTextContent("לא נספר ברווח");
  });
});
