import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopBand } from "./top-band";
import { expectRtl } from "./test-support";

describe("TopBand", () => {
  it("keeps the same violet ui-band in light and dark", () => {
    expectRtl();
    render(
      <TopBand>
        <h1>רווח</h1>
      </TopBand>,
    );
    const band = screen.getByRole("banner");
    expect(band).toHaveClass("ui-band");
    expect(screen.getByText("Flow")).toHaveAttribute("dir", "ltr");
    document.documentElement.dataset.theme = "light";
    const light = getComputedStyle(document.documentElement).getPropertyValue("--color-band").trim();
    document.documentElement.dataset.theme = "dark";
    const dark = getComputedStyle(document.documentElement).getPropertyValue("--color-band").trim();
    expect(light).toBe("#7B3FE4");
    expect(dark).toBe(light);
  });

  describe("scroll-linked fade (FLOW-363 3a)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    });

    /** Scrolls the page to `y` and runs the frame the scroll listener asked for. */
    function scrollTo(y: number) {
      Object.defineProperty(window, "scrollY", { value: y, configurable: true });
      act(() => {
        fireEvent.scroll(window);
      });
    }

    function fadeOf(): string {
      return screen.getByRole("banner").style.getPropertyValue("--band-fade");
    }

    it("is 1 at the top, 0 from 220px, and linear between, rounded to 0.05", () => {
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
      vi.stubGlobal("cancelAnimationFrame", () => undefined);
      render(
        <TopBand>
          <p className="ui-band-fade">רווח</p>
        </TopBand>,
      );
      expect(fadeOf()).toBe("1");
      scrollTo(60);
      expect(fadeOf()).toBe("1");
      scrollTo(120);
      expect(fadeOf()).toBe("0.65");
      scrollTo(140);
      expect(fadeOf()).toBe("0.5");
      scrollTo(220);
      expect(fadeOf()).toBe("0");
      scrollTo(400);
      expect(fadeOf()).toBe("0");
    });

    it("throttles the scroll to one update per frame", () => {
      const frames: FrameRequestCallback[] = [];
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      });
      vi.stubGlobal("cancelAnimationFrame", () => undefined);
      render(
        <TopBand>
          <p>רווח</p>
        </TopBand>,
      );
      frames.length = 0;
      Object.defineProperty(window, "scrollY", { value: 100, configurable: true });
      fireEvent.scroll(window);
      fireEvent.scroll(window);
      fireEvent.scroll(window);
      expect(frames).toHaveLength(1);
    });
  });
});
