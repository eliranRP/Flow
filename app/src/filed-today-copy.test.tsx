import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FILED_TODAY_EMPTY_BODY, FILED_TODAY_EMPTY_TITLE, filedTodayBannerTitle } from "./filed-today-copy";

describe("שויכו היום copy", () => {
  it("keeps the empty title and covers both sources", () => {
    expect(FILED_TODAY_EMPTY_TITLE).toBe("אין תנועות ששויכו היום");
    expect(FILED_TODAY_EMPTY_BODY).toBe("כש־SUMIT משייך תנועה בלי תור, או כשהעוזר מאשר תנועה היום, היא תופיע כאן.");
  });

  it("uses the queue clause only for the old set", () => {
    render(<p>{filedTodayBannerTitle(4, false)}</p>);
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText(/תנועות שויכו היום בלי להמתין בתור/)).toBeInTheDocument();
  });

  it("drops the queue clause when an assistant approval is in the count", () => {
    render(<p>{filedTodayBannerTitle(3, true)}</p>);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText(/תנועות שויכו היום$/)).toBeInTheDocument();
    expect(screen.queryByText(/בלי להמתין/)).not.toBeInTheDocument();
  });

  it("uses the singular, with no digit", () => {
    const { rerender } = render(<p>{filedTodayBannerTitle(1, false)}</p>);
    expect(screen.getByText("תנועה אחת שויכה היום בלי להמתין בתור")).toBeInTheDocument();
    rerender(<p>{filedTodayBannerTitle(1, true)}</p>);
    expect(screen.getByText("תנועה אחת שויכה היום")).toBeInTheDocument();
  });
});
