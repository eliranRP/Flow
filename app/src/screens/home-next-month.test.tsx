import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HOME_NEXT_MONTH_SAMPLE, NEXT_MONTH_TODAY } from "../dev/home-next-month-sample";
import { renderWithProviders } from "../test-render";
import { HomeNextMonth } from "./home-next-month";

describe("HomeNextMonth (FLOW-990)", () => {
  it("draws החודש הבא: the company's dashed card, opening its צפי page, and the six months' chart with November dashed", () => {
    renderWithProviders(<HomeNextMonth today={NEXT_MONTH_TODAY} currency="USD" sample={HOME_NEXT_MONTH_SAMPLE} />);
    expect(screen.getByRole("heading", { name: "החודש הבא" })).toBeInTheDocument();
    expect(screen.getByText("נובמבר")).toBeInTheDocument();
    expect(screen.getByText("צפוי להיכנס")).toBeInTheDocument();
    expect(screen.getByText("תזרים צפוי")).toBeInTheDocument();
    // FLOW-1000: the card opens the company צפי page.
    expect(screen.getByRole("link", { name: /^צפי נובמבר:.*פירוט ועריכה$/u })).toHaveAttribute("href", "/forecast/next");
    expect(screen.getByRole("img", { name: /^נכנס ויצא של החברה, מאי עד אוקטובר/u })).toBeInTheDocument();
    expect(document.querySelectorAll(".ui-fc-month-bars")).toHaveLength(7);
    expect(document.querySelector(".ui-fc-ahead")).not.toBeNull();
  });

  it("hides the whole section when nothing is expected next month", () => {
    const next = HOME_NEXT_MONTH_SAMPLE.next;
    const empty = { ...next, recurring: [], inputs: { ...next.inputs, projects: next.inputs.projects.map((project) => ({ ...project, categories: [] })), general: [], edits: [] } };
    const { container } = renderWithProviders(<HomeNextMonth today={NEXT_MONTH_TODAY} currency="USD" sample={{ ...HOME_NEXT_MONTH_SAMPLE, next: empty }} />);
    expect(container.querySelector(".ui-home-next")).toBeNull();
  });
});
