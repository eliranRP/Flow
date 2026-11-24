/**
 * FLOW-1303: when Home's first figures are drawn, which is when the splash may end. Read from the DOM, so
 * Home's own code (its entry chunk) carries nothing for it.
 *
 * Ready means one of:
 * - the app shows a route other than Home (the login screen when signed out, a deep link): nothing to wait for;
 * - an error state is up (a failed band or page);
 * - Home's figures are drawn (`.ui-band-body .ui-num`) and no skeleton or busy mark is left.
 */
const FIGURES = ".ui-band-body .ui-num";
const BUSY = ".ui-skeleton-bar, .ui-skel-row, .ui-skel-leaving, [aria-busy=true]";
const FAILED = ".ui-band-failed, .ui-page-failed";

export type HomeProbe = { path?: () => string };

function isReady(doc: Document, path: string): boolean {
  if (path !== "/") return true;
  if (doc.querySelector(FAILED) != null) return true;
  // The cheap lookup first: the busy scan runs only once figures exist.
  return doc.querySelector(FIGURES) != null && doc.querySelector(BUSY) == null;
}

/**
 * Calls `onReady` once, as soon as the page is ready (at once, if it already is). Returns a function that
 * stops watching; the watch also stops by itself when it fires. One MutationObserver, which the browser
 * batches per task, and no timer: nothing runs on the main thread between DOM changes. `probe.path` is for
 * stories, where the page's own path is not Home's.
 */
export function watchHomeReady(onReady: () => void, probe: HomeProbe = {}): () => void {
  const path = probe.path ?? (() => window.location.pathname);
  if (isReady(document, path())) {
    onReady();
    return () => undefined;
  }
  const observer = new MutationObserver(() => {
    if (!isReady(document, path())) return;
    observer.disconnect();
    onReady();
  });
  // Only what can change the answer: nodes coming and going, and a busy mark flipping.
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
  return () => {
    observer.disconnect();
  };
}
