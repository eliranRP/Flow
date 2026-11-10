import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ColdOpenSkeleton } from "./cold-open";

vi.mock("./cold-open-blocks", () => {
  throw new Error("offline");
});

describe("ColdOpenSkeleton when the blocks' file fails to load (FLOW-1145)", () => {
  it("keeps the route's bar and draws no blocks", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/loans"]}>
        <ColdOpenSkeleton />
      </MemoryRouter>,
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 600);
    });
    expect(screen.getByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    expect(container.querySelector(".ui-skel-loans-card")).toBeNull();
  });
});
