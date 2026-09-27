export function HomeSkeleton() {
  return (
    <div aria-busy="true">
      <p className="sr-only">טוען…</p>
      <header className="band-pad rounded-b-band bg-band px-side pb-10 text-on-band">
        <p dir="ltr" className="text-wordmark tracking-wordmark">
          Flow
        </p>
        <div className="skeleton-bar-band mt-8 h-4 w-28" />
        <div className="skeleton-bar-band mt-4 h-12 w-40" />
      </header>
      <div className="px-side py-section">
        <div className="skeleton-bar h-5 w-36" />
        <div className="skeleton-bar mt-3 h-4 w-full" />
        <div className="skeleton-bar mt-2 h-4 w-4/5" />
      </div>
    </div>
  );
}
