import { expect } from "storybook/test";

/** Text that may hold a "·": a dot box of HintParts, one-line text (clipped, a group title, the compact bar, the marker), a button. */
const DOTS_OK = ".ui-hint-wrap-sep, [data-clip-ok], button, .ui-btn, .ui-group-title, .ui-compact-bar, .ui-uri-marker";

/**
 * FLOW-1173 (FLOW-1153's rule): no line under `root` starts or ends with "·" or "•". Every wrapping line that joins
 * parts with a dot goes through HintParts, and a HintParts dot that shows sits on the line of the part before it (the
 * dot of a part that opens a line is in the clipped margin).
 */
export async function expectNoOrphanDots(root: Element) {
  const loose: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (/[·•]/.test(text) && node.parentElement?.closest(DOTS_OK) == null) loose.push(text);
  }
  await expect(loose).toEqual([]);
  const opening: string[] = [];
  for (const wrap of root.querySelectorAll(".ui-hint-wrap")) {
    const clip = wrap.getBoundingClientRect();
    for (const sep of wrap.querySelectorAll(".ui-hint-wrap-sep")) {
      const box = sep.getBoundingClientRect();
      const shown = box.left >= clip.left - 0.5 && box.right <= clip.right + 0.5;
      const part = sep.parentElement;
      const before = part?.previousElementSibling;
      if (!shown || part == null || before == null) continue;
      if (Math.abs(before.getBoundingClientRect().top - part.getBoundingClientRect().top) > 1) opening.push(part.textContent);
    }
  }
  await expect(opening).toEqual([]);
}
