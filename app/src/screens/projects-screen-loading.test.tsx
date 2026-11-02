import { afterEach, describe, expect, it, vi } from "vitest";
import { devProjectsCash } from "../dev/projects-sample";
import { renderWithProviders } from "../test-render";
import { sampleDashboard } from "../ui/screen-stories-support";
import { ProjectsScreen } from "./projects-screen";

// FLOW-1017: the company card's reads out (or done), whatever the sample list.
const state = vi.hoisted(() => ({ loading: false }));
vi.mock("./company-cash-next-month", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./company-cash-next-month")>();
  return {
    ...actual,
    useCompanyCashNextMonth: () => ({ forecast: null, loading: state.loading, failed: false, paused: false, refetch: () => Promise.resolve(), categories: [] }),
  };
});

afterEach(() => {
  state.loading = false;
});

describe("the Projects tab's company card slot (FLOW-1017)", () => {
  it("holds the card's place while the forecast is read, so the rows under it do not jump", () => {
    state.loading = true;
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} />);
    expect(document.querySelector(".ui-projects-next")?.classList.contains("ui-projects-next-loading")).toBe(true);
  });

  it("gives the place back once the read is done and nothing is expected", () => {
    renderWithProviders(<ProjectsScreen sample={sampleDashboard} cashSample={devProjectsCash} />);
    const slot = document.querySelector(".ui-projects-next");
    expect(slot?.classList.contains("ui-projects-next-loading")).toBe(false);
    expect(slot).toBeEmptyDOMElement();
  });
});
