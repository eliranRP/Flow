// @vitest-environment node
// FLOW-363 (1/4): the motion tokens, their reduced-motion values and the motion utilities.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tokensCss = readFileSync(new URL("../../../design/system/implementation-tokens.css", import.meta.url), "utf8");
const motionCss = readFileSync(new URL("./css/00-motion.css", import.meta.url), "utf8");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of the first block that starts with `head` (e.g. ":root {"), brace-matched. */
function blockBody(css: string, head: string): string {
  const start = css.indexOf(head);
  if (start < 0) throw new Error(`no block starting "${head}"`);
  let depth = 0;
  for (let i = start + head.length - 1; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") {
      depth--;
      if (depth === 0) return css.slice(start + head.length, i);
    }
  }
  throw new Error(`unclosed block "${head}"`);
}

/** Custom property declarations in a block: name -> value. */
function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, name = "", value = ""] of stripComments(body).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(name, value.trim());
  }
  return map;
}

const rootTokens = declarations(blockBody(tokensCss, ":root {"));
const reducedTokens = declarations(blockBody(tokensCss, "@media (prefers-reduced-motion: reduce) {"));
const motionTokenNames = [...rootTokens.keys()].filter((name) => name.startsWith("--motion-"));

describe("motion tokens in implementation-tokens.css", () => {
  it("defines the motion tokens in the light :root block", () => {
    expect(motionTokenNames.length).toBeGreaterThan(0);
  });

  it("sets every --motion-* token to 0ms when the user asks for reduced motion", () => {
    // The two sheet tokens stay at 1ms: Vaul has no animationend fallback (10-settings-onboarding.css).
    for (const name of motionTokenNames) {
      const expected = name === "--motion-sheet-in" || name === "--motion-sheet-out" ? "1ms" : "0ms";
      expect(reducedTokens.get(name), name).toBe(expected);
    }
  });

  it("sets the rise distances to 0px and the shimmer to 0ms under reduced motion", () => {
    expect(reducedTokens.get("--rise-page")).toBe("0px");
    expect(reducedTokens.get("--rise-push")).toBe("0px");
    expect(reducedTokens.get("--rise-toast")).toBe("0px");
    expect(reducedTokens.get("--dur-shimmer")).toBe("0ms");
  });

  it("keeps the approved motion values", () => {
    const expected: Record<string, string> = {
      "--ease-enter": "cubic-bezier(0.2, 0.8, 0.2, 1)",
      "--ease-exit": "cubic-bezier(0.4, 0, 1, 1)",
      "--ease-standard": "cubic-bezier(0.4, 0, 0.2, 1)",
      "--ease-linear": "linear",
      "--motion-press": "120ms",
      "--motion-fast": "150ms",
      "--motion-width": "300ms",
      "--skeleton-delay": "300ms",
      "--motion-toast-out": "160ms",
      "--motion-fade": "200ms",
      "--motion-sheet-out": "220ms",
      "--motion-bar": "240ms",
      "--motion-scrim": "260ms",
      "--motion-page": "280ms",
      "--motion-sheet-in": "280ms",
      "--motion-stagger": "40ms",
      "--motion-bar-grow": "480ms",
      "--motion-pulse": "1.2s",
      "--motion-spin": "800ms",
      "--rise-page": "8px",
      "--rise-push": "24px",
      "--rise-toast": "12px",
      "--dur-shimmer": "1400ms",
      "--toast-duration": "3000ms",
      "--toast-duration-error": "4000ms",
    };
    for (const [name, value] of Object.entries(expected)) {
      expect(rootTokens.get(name), name).toBe(value);
    }
  });

  it("no longer defines the old --dur-* motion tokens", () => {
    for (const name of ["--dur-press", "--dur-fast", "--dur-base", "--dur-sheet-in", "--dur-sheet-out"]) {
      expect(rootTokens.has(name), name).toBe(false);
    }
  });
});

describe("00-motion.css", () => {
  const css = stripComments(motionCss);

  it("writes every duration and easing as a token, never a raw value", () => {
    expect(css).not.toMatch(/\b\d+(\.\d+)?(ms|s)\b/);
    expect(css).not.toMatch(/cubic-bezier\(/);
    expect(css).not.toMatch(/(?<![-\w])(linear|ease-in-out|ease-in|ease-out|ease)(?![-\w])/);
  });

  it("uses only var(--motion-*), var(--ease-*) and var(--rise-*) for its timing and distances", () => {
    // --i is the stagger index a page sets on each child (see .m-page-enter), not a timing value.
    for (const match of css.matchAll(/var\(--([\w-]+)/g)) {
      expect(match[1], match[0]).toMatch(/^(motion-|ease-|rise-|i$)/);
    }
  });

  it("leaves reduced motion to the tokens, so an exit still ends hidden and fires animationend", () => {
    // `animation: none` would drop the `forwards` end state (a leaving page or bar would show again)
    // and Vaul-style waits on animationend would hang; the tokens already make each run 0ms (sheets 1ms).
    expect(css).not.toMatch(/prefers-reduced-motion/);
    expect(css).not.toMatch(/animation\s*:\s*none/);
    for (const name of [".m-push-back", ".m-sheet-out", ".m-bar-out", ".m-row-leave"]) {
      expect(css, name).toMatch(new RegExp(`\\${name}\\s*\\{[^}]*animation:[^;]*forwards`));
    }
  });

  /** The declarations inside `selector { … }` (first match). */
  function rule(selector: string): string {
    const match = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
    if (!match) throw new Error(`no rule ${selector}`);
    return match[1] ?? "";
  }
  /** The `to` (or `from`) frame of a keyframes block. */
  function frame(name: string, which: "from" | "to"): string {
    return blockBody(css, `@keyframes ${name} {`).split(new RegExp(`\\b${which}\\s*\\{`))[1]?.split("}")[0] ?? "";
  }

  it("presses at opacity .72, and buttons also scale to .985", () => {
    const live = ':not(:disabled, [aria-disabled="true"])';
    expect(rule(`.m-press:active${live}`)).toMatch(/opacity:\s*0\.72;/);
    expect(rule(`.m-press.m-press-scale:active${live}`)).toMatch(/transform:\s*scale\(0\.985\);/);
    expect(rule(".m-press")).toMatch(/var\(--motion-press\)/);
  });

  it("staggers only the first five blocks, 40ms apart", () => {
    expect(rule(".m-page-enter")).toMatch(/animation-delay:\s*calc\(min\(var\(--i, 0\), 4\) \* var\(--motion-stagger\)\)/);
    expect(frame("m-page-enter", "from")).toMatch(/translateY\(var\(--rise-page\)\)/);
  });

  it("pushes a detail page in from the left and takes it back to the left (RTL)", () => {
    expect(frame("m-push-in", "from")).toMatch(/translateX\(calc\(-1 \* var\(--rise-push\)\)\)/);
    expect(frame("m-push-back", "to")).toMatch(/translateX\(calc\(-1 \* var\(--rise-push\)\)\)/);
  });

  it("grows thin bars from the right", () => {
    expect(rule(".m-bar-grow")).toMatch(/transform-origin:\s*right;/);
    expect(frame("m-bar-grow", "from")).toMatch(/scaleX\(0\)/);
  });

  it("uses ease-enter for what arrives and ease-exit for what leaves, each on its token", () => {
    const expected: [string, string, string][] = [
      [".m-page-enter", "--motion-page", "--ease-enter"],
      [".m-push-in", "--motion-page", "--ease-enter"],
      [".m-sheet-in", "--motion-sheet-in", "--ease-enter"],
      [".m-bar-in", "--motion-bar", "--ease-enter"],
      [".m-bar-grow", "--motion-bar-grow", "--ease-enter"],
      [".m-push-back", "--motion-sheet-out", "--ease-exit"],
      [".m-sheet-out", "--motion-sheet-out", "--ease-exit"],
      [".m-bar-out", "--motion-bar", "--ease-exit"],
      [".m-row-leave", "--motion-sheet-out", "--ease-exit"],
    ];
    for (const [selector, duration, easing] of expected) {
      expect(rule(selector), selector).toMatch(new RegExp(`animation:[^;]*var\\(${duration}\\) var\\(${easing}\\)`));
    }
  });

  it("collapses a leaving row from 1fr to 0fr, never a measured height", () => {
    expect(frame("m-row-leave", "from")).toMatch(/grid-template-rows:\s*1fr/);
    expect(frame("m-row-leave", "to")).toMatch(/grid-template-rows:\s*0fr/);
    expect(css).not.toMatch(/(?<![-\w])height\s*:/);
  });

  it("names the motion classes the app uses", () => {
    for (const name of [".m-press", ".m-press-scale", ".m-page-enter", ".m-push-in", ".m-push-back", ".m-sheet-in", ".m-sheet-out", ".m-bar-in", ".m-bar-out", ".m-row-leave", ".m-bar-grow"]) {
      expect(css).toContain(name);
    }
  });
});
