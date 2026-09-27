import { Wordmark } from "./Wordmark";

export function HomeSkeleton({ previewing = false }: { previewing?: boolean }) {
  return (
    <div className="flex min-h-full flex-1 flex-col" aria-busy="true">
      <p className="sr-only">טוען…</p>
      <header className="band">
        <div className="band-row">
          <Wordmark tone="on-band" />
        </div>
        {previewing ? <p className="preview-banner t-hint">מצב תצוגה</p> : null}
        <div className="band-hero">
          <div className="skeleton-bar-band h-4 w-28" />
          <div className="skeleton-bar-band mt-3 h-4 w-36" />
          <div className="skeleton-bar-band mt-4 h-12 w-52" />
        </div>
      </header>
      <div className="px-side py-section">
        <div className="skeleton-bar h-5 w-40" />
        <div className="skeleton-bar mt-3 h-4 w-full" />
        <div className="skeleton-bar mt-2 h-4 w-4/5" />
      </div>
    </div>
  );
}
