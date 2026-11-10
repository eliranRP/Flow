import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { FullScreenFallback } from "./cold-open";

const reads = vi.hoisted(() => ({ count: 0 }));

vi.mock("./cold-open-blocks", async (importOriginal) => {
  reads.count += 1;
  return importOriginal<typeof import("./cold-open-blocks")>();
});

describe("FullScreenFallback (FLOW-1145)", () => {
  it("starts reading the blocks' file when it first draws, before its 300ms wait", async () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/loans"]}>
        <FullScreenFallback />
      </MemoryRouter>,
    );
    await vi.waitFor(() => {
      expect(reads.count).toBe(1);
    }, { timeout: 200 });
    // The wait still holds the frame back.
    expect(container.querySelector(".ui-skel-loans-card")).toBeNull();
  });
});
