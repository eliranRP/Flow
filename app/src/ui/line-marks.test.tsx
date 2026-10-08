import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { KeptOutTag, rowSource } from "./line-marks";
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
        <ListRow variant="transaction" title="ריבית" agorot={-41_200n} sign="out" source={rowSource("sumit")} tag={<KeptOutTag label="מחוץ לרווח והפסד" />} href="/transactions/t2" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("img", { name: "מחוץ לרווח והפסד" })).toBeInTheDocument();
  });
});
