import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cashMonthName } from "../cash";
import { cash as flipCash, investment as flipInvestment, project as flipProject, thisMonth } from "../dev/project-cash-sample";
import { kindNextSample } from "../dev/project-kinds-next-sample";
import { kindSample } from "../dev/project-kinds-sample";
import { devProjectsCash } from "../dev/projects-sample";
import { shiftMonthKey } from "../period";
import { monthWord } from "../project-next-edit";
import { renderWithProviders } from "../test-render";
import { ProjectDetailScreen } from "./flow-screens";

// The project page's next-month card and month chart (canvas note spec-fcwide), by kind. The samples' months
// run from today, so the month names are worked out here too.

const next = cashMonthName(shiftMonthKey(thisMonth, 1));
const previous = monthWord(shiftMonthKey(thisMonth, -1));

function renderKind(kind: "rental" | "client") {
  const data = kindSample(kind, devProjectsCash.projects[0]);
  return renderWithProviders(
    <ProjectDetailScreen sample={data.project} sampleCash={data.cash} sampleInvestment={data.investment} sampleMenuRow={data.row} sampleNext={data.next} />,
  );
}

function renderFlip() {
  const base = devProjectsCash.projects[0];
  const row = base == null ? undefined : { ...base, id: flipProject.id, first_month: `${shiftMonthKey(thisMonth, -3)}-01`, deletable: false };
  return renderWithProviders(
    <ProjectDetailScreen sample={flipProject} sampleCash={flipCash} sampleInvestment={flipInvestment} sampleMenuRow={row} sampleNext={kindNextSample("flip", flipProject.id)} />,
  );
}

function bar(chart: HTMLElement, month: number, side: "in" | "out"): string {
  return (chart.children[month]?.querySelector(`.ui-fc-bar-${side}`) as HTMLElement | null)?.style.blockSize ?? "";
}

describe("the project page's next month (spec-fcwide)", () => {
  it("a rental: the card says תזרים צפוי and opens the צפי page; six months and the forecast; the link opens the profit page", () => {
    const { container } = renderKind("rental");
    expect(screen.queryByRole("heading", { name: "חודשים קודמים" })).not.toBeInTheDocument();
    const card = screen.getByRole("link", { name: new RegExp(`^צפי ${next}:`) });
    expect(card.getAttribute("href")).toBe("/projects/p-rental/profit/next");
    expect(within(card).getByText("2 שכירויות קבועות")).toBeInTheDocument();
    expect(within(card).getByText(`מול $1,740 ב${previous}`)).toBeInTheDocument();
    expect(container.querySelector(".ui-fc-net")?.textContent).toBe("תזרים צפוי+$2,285");
    const chart = screen.getByRole("img", { name: /^הכנסות והוצאות לפי חודש, / });
    expect(chart.children).toHaveLength(7);
    expect(chart.getAttribute("aria-label")).toContain("הכנסות $4,150, הוצאות $1,865");
    expect(screen.getByText(`${monthWord(shiftMonthKey(thisMonth, -5))} עד ${monthWord(thisMonth)} וצפי`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "רווח לפי חודש" }).getAttribute("href")).toBe("/projects/p-rental/profit?period=all");
    // The chart comes after the investment card, where "חודשים קודמים" was.
    expect(screen.getByRole("heading", { name: "השקעה והלוואות" }).compareDocumentPosition(chart)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("a flip: since the purchase, which sets the scale; no income, so the $0 is grey", () => {
    const { container } = renderFlip();
    const chart = screen.getByRole("img", { name: /^הכנסות והוצאות לפי חודש, מתחילת הפרויקט, / });
    expect(chart.children).toHaveLength(5);
    expect(screen.getByText("מתחילת הפרויקט וצפי")).toBeInTheDocument();
    expect(bar(chart, 0, "out")).toBe("108px");
    expect(bar(chart, 0, "in")).toBe("2px");
    expect(bar(chart, 4, "in")).toBe("2px");
    // November's renovation average, $12,000 against the $185,000 purchase: the 4px floor.
    expect(bar(chart, 4, "out")).toBe("7px");
    const zero = container.querySelector(".ui-fc-col-zero");
    expect(zero?.textContent).toBe("הכנסות צפויות$0אין הכנסה צפויה");
    expect(container.querySelector(".ui-fc-net")?.textContent).toBe("תזרים צפוי−$12,000");
    expect(screen.getByText(`מול $38,120 ב${previous}`)).toBeInTheDocument();
  });

  it("a client job: the client's payment and the subcontractor the owner added, against last month's cash", () => {
    const { container } = renderKind("client");
    const card = screen.getByRole("link", { name: new RegExp(`^צפי ${next}:`) });
    expect(within(card).getByText("תשלום מהלקוח")).toBeInTheDocument();
    expect(within(card).getByText(`מול $21,600 ב${previous}`)).toBeInTheDocument();
    expect(container.querySelector(".ui-fc-net")?.textContent).toBe("תזרים צפוי+$8,300");
    expect(screen.getByText("מתחילת הפרויקט וצפי")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^הכנסות והוצאות לפי חודש/ }).children).toHaveLength(4);
  });

  it("a project with nothing filed yet shows neither", () => {
    const data = kindSample("new", devProjectsCash.projects[0]);
    renderWithProviders(<ProjectDetailScreen sample={data.project} sampleCash={data.cash} sampleInvestment={data.investment} sampleMenuRow={data.row} />);
    expect(screen.queryByRole("img", { name: /^הכנסות והוצאות לפי חודש/ })).not.toBeInTheDocument();
    expect(document.querySelector(".ui-fc-card")).toBeNull();
  });
});
