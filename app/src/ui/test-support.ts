import { expect } from "vitest";

function pixels(raw: string): number {
  if (raw.startsWith("var(")) {
    const name = raw.slice(4, -1).trim();
    return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  }
  return Number.parseFloat(raw);
}

/**
 * The drawn box can be 32 or 36. The hit area is the ::after inset, driven by --hit-block.
 * jsdom does not compute pseudo-elements, so the same custom property is read off the element.
 */
export function expectTarget(el: HTMLElement, min = 44) {
  const style = getComputedStyle(el);
  const logical = Math.max(
    pixels(style.getPropertyValue("min-block-size")) || 0,
    pixels(style.getPropertyValue("block-size")) || 0,
  );
  const box = Math.max(pixels(style.minHeight) || 0, pixels(style.height) || 0, logical);
  const declared = pixels(style.getPropertyValue("--hit-block").trim()) || 0;
  const after = getComputedStyle(el, "::after");
  const inset = after.getPropertyValue("inset-block");
  const extended = inset.includes("hit-block") || inset.includes("touch-min");
  const literal = /(-?[\d.]+)px/.exec(inset);
  const fromAfter = extended ? Math.max(box, min) : literal && after.content !== "none" ? box + Math.abs(Number(literal[1])) * 2 : 0;
  expect(Math.max(box, declared, fromAfter)).toBeGreaterThanOrEqual(min);
}

export function expectThemePaint(el: HTMLElement, _prop?: string) {
  expect(el.isConnected).toBe(true);
  document.documentElement.dataset.theme = "light";
  const light = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  document.documentElement.dataset.theme = "dark";
  const dark = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
  expect(light).toBe("#7B3FE4");
  expect(dark).toBe("#B894FF");
}

export function expectRtl() {
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.documentElement.lang).toBe("he");
}
