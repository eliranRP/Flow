import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ColdOpenSkeleton } from "./cold-open";

const reads = vi.hoisted(() => ({ count: 0 }));

// The first read of the blocks' file is slow and then fails (offline), after the frame's 300ms wait has
// asked for the blocks; the next read loads it.
vi.mock("./cold-open-blocks", async (importOriginal) => {
  reads.count += 1;
  if (reads.count === 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
    throw new Error("offline");
  }
  return importOriginal<typeof import("./cold-open-blocks")>();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ColdOpenSkeleton />
    </MemoryRouter>,
  );
}

describe("ColdOpenSkeleton when the blocks' file fails to load (FLOW-1145)", () => {
  it("keeps the route's bar and draws no blocks, and the next frame reads the file again", async () => {
    const first = renderAt("/loans");
    await new Promise((resolve) => {
      setTimeout(resolve, 900);
    });
    expect(screen.getByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    expect(first.container.querySelector(".ui-skel-loans-card")).toBeNull();
    first.unmount();

    const next = renderAt("/loans");
    await waitFor(() => {
      expect(next.container.querySelector(".ui-skel-loans-card")).not.toBeNull();
    }, { timeout: 3000 });
    expect(reads.count).toBe(2);
  });
});
