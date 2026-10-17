import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { kindSample, type ProjectKind } from "../dev/project-kinds-sample";
import { devProjectsCash } from "../dev/projects-sample";
import { renderWithProviders } from "../test-render";
import { ProjectDetailScreen } from "./project-detail-screen";

function renderKind(kind: Exclude<ProjectKind, "flip">) {
  const data = kindSample(kind, devProjectsCash.projects[0]);
  return renderWithProviders(
    <ProjectDetailScreen sample={data.project} sampleCash={data.cash} sampleInvestment={data.investment} sampleMenuRow={data.row} />,
  );
}

describe("the project page by kind (FLOW-445b)", () => {
  it("a rental: the open month says עד היום, the profit rows are signed, the summary card shows, no budget link", () => {
    renderKind("rental");
    expect(screen.getByText(/^תזרים .* · עד היום$/)).toBeInTheDocument();
    expect(document.body.textContent).toContain("+$3,795.60");
    expect(screen.getByText("מאז מרץ 2025")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "השקעה והלוואות" })).toBeInTheDocument();
    expect(screen.getByText("$160K")).toBeInTheDocument();
    expect(screen.queryByText("+ הוספת תקציב")).not.toBeInTheDocument();
  });

  it("a client job: the budget card and the profit rows, with no investment card", () => {
    renderKind("client");
    expect(screen.getByRole("heading", { name: "תקציב" })).toBeInTheDocument();
    expect(screen.getByText("+$15,000")).toBeInTheDocument();
    expect(screen.getByText("מאז אוגוסט 2026")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "השקעה והלוואות" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "חודשים קודמים" })).toBeInTheDocument();
  });

  it("a project with nothing filed yet: the budget, then the empty card, and no profit rows", () => {
    renderKind("new");
    expect(screen.getByRole("heading", { name: "אין עדיין תנועות" })).toBeInTheDocument();
    expect(screen.queryByText("רווח מתחילת הפרויקט")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "תקציב" })).toBeInTheDocument();
  });
});
