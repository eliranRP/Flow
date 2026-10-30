import { useLayoutEffect, useRef } from "react";

type Measure = typeof import("./hint-cut-measure");
let measuring: Promise<Measure> | null = null;

/** The measuring code, loaded once, on the first hint part drawn. */
function measure(): Promise<Measure> {
  measuring ??= import("./hint-cut-measure");
  return measuring;
}

/**
 * FLOW-172: a hint part's text, cut where it overflows at its last letter that fits with "…", never after
 * a space ("Quick…", not "Quick …"; CSS's own ellipsis cannot trim it). The text stays whole in the DOM,
 * so the part keeps its width and screen readers read all of it; the cut is drawn over it from `data-cut`
 * (css/02-fields-sheets.css). The measuring (hint-cut-measure.ts) loads once, out of Home's first load,
 * so on the very first visit a cut part shows CSS's own "…" for a frame.
 */
export function HintText({ text, dir }: { text: string; dir?: "auto" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element == null) return;
    let live = true;
    let stop: (() => void) | undefined;
    void measure().then((module) => { if (live) stop = module.watch(element); });
    return () => {
      live = false;
      stop?.();
    };
  }, []);
  // A new text in the same box is measured again: the observer reports only a new size.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element == null) return;
    if (seen.current) void measure().then((module) => { module.queue(element); });
    seen.current = true;
  }, [text]);
  return <span ref={ref} className="ui-hint-text" dir={dir} data-clip-ok="">{text}</span>;
}
