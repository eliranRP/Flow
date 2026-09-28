import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ListRow } from "./list-row";
import { expectRtl, expectTarget } from "./test-support";

describe("ListRow", () => {
  it("renders project, transaction, review, and supplier rows", () => {
    expectRtl();
    render(
      <MemoryRouter>
        <>
          <ListRow variant="project" title="הרצל" hint="רווחיות 27%" agorot={20000000n} href="/projects/1" />
          <ListRow variant="project" title="הפסד" agorot={-1000000n} loss />
          <ListRow variant="transaction" title="בנק" agorot={1200000n} sign="out" source="bank" />
          <ListRow variant="item" title="ביטוח המגן" hint="ספק · פטור ממע״מ" />
        </>
      </MemoryRouter>,
    );
    expectTarget(screen.getByRole("link", { name: /הרצל/ }));
    expect(screen.getByText("−₪10,000")).toHaveClass("ui-loss");
    expect(screen.getByText("ספק · פטור ממע״מ")).toBeInTheDocument();
    expect(screen.getByText("₪12,000")).toBeInTheDocument();
  });
});
