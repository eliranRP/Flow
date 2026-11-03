/** Work that must outlive the response. */
export type Defer = (work: Promise<unknown>) => void;

type EdgeRuntimeLike = { waitUntil?: (work: Promise<unknown>) => void };

/** EdgeRuntime.waitUntil, bound to the runtime; undefined where the runtime has none (tests, local). */
export function edgeWaitUntil(): Defer | undefined {
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  const waitUntil = runtime?.waitUntil;
  if (typeof waitUntil !== "function") return undefined;
  return (work) => waitUntil.call(runtime, work);
}
