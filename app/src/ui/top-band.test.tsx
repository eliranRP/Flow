import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BandCompany, TopBand, bandFade, pageAtEnd, useBandGone, usePageAtEnd } from "./top-band";
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
      Reflect.deleteProperty(document.documentElement, "scrollHeight");
    });

    /** Makes the page scroll `max` px: its height is the viewport's plus that. */
    function pageScrolls(max: number) {
      Object.defineProperty(document.documentElement, "scrollHeight", { value: window.innerHeight + max, configurable: true });
    }

    function syncFrames() {
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });
      vi.stubGlobal("cancelAnimationFrame", () => undefined);
    }

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

    it("ends the fade at the bottom of a page too short to scroll 220px, so the compact bar can show", () => {
      // A page that scrolls 141px: gone at its bottom (less a pixel), half way at 100px.
      expect(bandFade(60, 141)).toBe(1);
      expect(bandFade(100, 141)).toBe(0.5);
      expect(bandFade(140, 141)).toBe(0);
      expect(bandFade(141, 141)).toBe(0);
      // A tall page keeps 60 to 220; a page that cannot reach 60 never fades.
      expect(bandFade(140, 2000)).toBe(0.5);
      expect(bandFade(220, 2000)).toBe(0);
      expect(bandFade(40, 50)).toBe(1);
    });

    it("fades out at the bottom of a short page, and the compact bar's hooks follow its height", () => {
      syncFrames();
      pageScrolls(141);
      render(
        <TopBand>
          <p className="ui-band-fade">רווח</p>
        </TopBand>,
      );
      const gone = renderHook(() => useBandGone());
      const end = renderHook(() => usePageAtEnd());
      scrollTo(100);
      expect(fadeOf()).toBe("0.5");
      expect(gone.result.current).toBe(false);
      scrollTo(140);
      expect(fadeOf()).toBe("0");
      expect(gone.result.current).toBe(true);
      expect(end.result.current).toBe(true);
      // The page grows with no scroll (data loads at the bottom): the next resize or scroll reads it.
      pageScrolls(2000);
      act(() => {
        fireEvent(window, new Event("resize"));
      });
      expect(fadeOf()).toBe("0.5");
      expect(gone.result.current).toBe(false);
      expect(end.result.current).toBe(false);
    });

    it("is at the end only on a page that scrolls past 60px, from its bottom less a pixel", () => {
      expect(pageAtEnd(140, 141)).toBe(true);
      expect(pageAtEnd(139, 141)).toBe(false);
      expect(pageAtEnd(1999, 2000)).toBe(true);
      expect(pageAtEnd(220, 2000)).toBe(false);
      expect(pageAtEnd(50, 50)).toBe(false);
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

describe("TopBand tone and the company button (FLOW-364)", () => {
  it("is the darker band for a past month", () => {
    render(
      <TopBand tone="past">
        <h1>תזרים · חודש סגור</h1>
      </TopBand>,
    );
    expect(screen.getByRole("banner")).toHaveClass("ui-band", "ui-band-past");
  });

  it("opens the company sheet from the company button at the start of the band", () => {
    const onOpen = vi.fn();
    render(<TopBand leading={<BandCompany name="חברה לדוגמה" onOpen={onOpen} />} />);
    fireEvent.click(screen.getByRole("button", { name: "חברה: חברה לדוגמה" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
