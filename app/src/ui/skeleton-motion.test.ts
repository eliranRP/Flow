// @vitest-environment node
// FLOW-371: reduced motion stops the pulse and the sync line but keeps the text; a busy button keeps its width.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skeletonCss = readFileSync(new URL("./css/09-sign-in-project.css", import.meta.url), "utf8");
const statesCss = readFileSync(new URL("./css/08-tabbar-empty.css", import.meta.url), "utf8");
const buttonCss = readFileSync(new URL("./css/01-base.css", import.meta.url), "utf8");

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The body of every block that starts with `head`, brace-matched. */
function blockBodies(css: string, head: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const start = css.indexOf(head, from);
    if (start < 0) return bodies;
    let depth = 0;
    for (let i = start + head.length - 1; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}") {
        depth--;
        if (depth === 0) {
          bodies.push(css.slice(start + head.length, i));
          from = i + 1;
          break;
        }
      }
    }
  }
}

const reduced = (css: string) => blockBodies(stripComments(css), "@media (prefers-reduced-motion: reduce) {");

describe("reduced motion (FLOW-371)", () => {
  it("stops the skeleton pulse", () => {
    const body = reduced(skeletonCss).join("\n");
    expect(body).toMatch(/\.ui-skeleton-bar[^{]*\{[^}]*animation:\s*none/);
  });

  it("stops the sync line and spinner but keeps the pill and its text", () => {
    const body = reduced(statesCss).join("\n");
    expect(body).toMatch(/\.ui-sync-line[^{]*\{[^}]*animation:\s*none/);
    expect(body).toMatch(/\.ui-sync-spin[^{]*\{[^}]*animation:\s*none/);
    expect(body).not.toMatch(/display:\s*none|visibility:\s*hidden/);
  });
});

describe("busy button width (FLOW-371)", () => {
  const css = stripComments(buttonCss + statesCss);

  it("takes the spinner out of flow so the label keeps the button's width", () => {
    expect(css).toMatch(/\.ui-btn\[aria-busy="true"\]\s*>\s*\.ui-spinner\s*\{[^}]*position:\s*absolute;/);
  });

  it("does not give a busy button a tint fill or extra padding", () => {
    const busy = [...css.matchAll(/\.ui-btn\[aria-busy="true"\][^{]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
    expect(busy).not.toMatch(/padding/);
  });
});
