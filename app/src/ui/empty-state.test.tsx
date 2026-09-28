import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";
import { expectRtl } from "./test-support";

describe("EmptyState", () => {
  it("shows an icon, a title, one line, and at most one action", () => {
    expectRtl();
    render(<EmptyState icon={<span>◌</span>} title="עוד אין נתונים" body="הרווח יופיע כאן." action={<button type="button">חיבור</button>} />);
    expect(screen.getByText("עוד אין נתונים")).toBeInTheDocument();
    expect(screen.getByText("הרווח יופיע כאן.")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
