import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FILED_TODAY_EMPTY_BODY, FILED_TODAY_EMPTY_TITLE, filedTodayBannerTitle } from "./filed-today-copy";

describe("שויכו היום copy", () => {
  it("keeps the empty title and covers both sources", () => {
    expect(FILED_TODAY_EMPTY_TITLE).toBe("אין תנועות ששויכו היום");
    expect(FILED_TODAY_EMPTY_BODY).toBe("כש־SUMIT משייך תנועה בלי תור, או כשהעוזר מאשר תנועה היום, היא תופיע כאן.");
  });

  it("uses the plural auto-filed copy with an LTR count", () => {
    render(<p>{filedTodayBannerTitle(4)}</p>);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/^שויכו אוטומטית היום$/)).toBeInTheDocument();
    expect(screen.queryByText(/תנועות/)).not.toBeInTheDocument();
    expect(screen.queryByText(/בלי להמתין/)).not.toBeInTheDocument();
  });

  it("uses the singular auto-filed copy with no digit", () => {
    render(<p>{filedTodayBannerTitle(1)}</p>);
    expect(screen.getByText("אחת שויכה אוטומטית היום")).toBeInTheDocument();
    expect(screen.queryByText(/בלי להמתין/)).not.toBeInTheDocument();
  });
});
