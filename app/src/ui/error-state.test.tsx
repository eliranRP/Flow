import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErrorState } from "./error-state";
import { expectRtl, expectTarget } from "./test-support";

describe("ErrorState", () => {
  it("uses the tint retry for offline and server failures (DESIGN-RULES §2.8)", () => {
    expectRtl();
    const { rerender } = render(<ErrorState offline onRetry={() => undefined} />);
    expect(screen.getByText("אין חיבור לאינטרנט")).toBeInTheDocument();
    expectTarget(screen.getByRole("button", { name: "ניסיון חוזר" }));
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).toHaveClass("ui-btn-pill");
    expect(screen.getByRole("button", { name: "ניסיון חוזר" })).not.toHaveClass("ui-btn-retry");
    rerender(<ErrorState offline={false} onRetry={() => undefined} />);
    expect(screen.getByText("לא הצלחנו לטעון את הנתונים")).toBeInTheDocument();
  });
});
