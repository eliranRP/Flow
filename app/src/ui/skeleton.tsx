import { Wordmark } from "./wordmark";

const rowKeys = ["a", "b", "c"] as const;

export function Skeleton({ className }: { className?: string }) {
  return <span className={className ? `skeleton-bar ${className}` : "skeleton-bar"} />;
}

export function Loader({ label = "טוען…" }: { label?: string }) {
  return (
    <p className="ui-hit" role="status" aria-busy="true">
      <span className="ui-spinner" aria-hidden="true" /> {label}
    </p>
  );
}

/** ld-01 layout. The period pill is omitted until the P&L period exists (0045). */
export function HomeSkeleton({ previewing = false }: { previewing?: boolean }) {
  return (
    <div className="flex min-h-full flex-1 flex-col" aria-busy="true">
      <p className="sr-only">טוען…</p>
      <header className="band">
        <div className="band-row">
          <Wordmark tone="on-band" />
        </div>
        {previewing ? <p className="preview-banner t-hint">מצב תצוגה</p> : null}
        <div className="home-skel-gr">
          <span className="skeleton-bar-band home-skel-greet" />
          <span className="skeleton-bar-band home-skel-greet-side" />
        </div>
        <div className="home-skel-hero">
          <span className="skeleton-bar-band home-skel-label" />
          <span className="skeleton-bar-band home-skel-amount" />
          <div className="home-skel-change">
            <span className="skeleton-bar-band home-skel-pill" />
            <span className="skeleton-bar-band home-skel-delta" />
          </div>
        </div>
        <div className="home-skel-ie">
          <span className="skeleton-bar-band home-skel-ie-bar" />
          <span className="skeleton-bar-band home-skel-ie-bar" />
        </div>
      </header>
      <div className="home-skel-card">
        <span className="skeleton-bar home-skel-card-icon" />
        <div className="home-skel-card-text">
          <span className="skeleton-bar home-skel-card-title" />
          <span className="skeleton-bar home-skel-card-sub" />
        </div>
      </div>
      <section className="home-skel-sec">
        <h2 className="t-title-3">פרויקטים מובילים</h2>
        <div className="home-skel-rows">
          {rowKeys.map((key) => (
            <div className="home-skel-row" key={key}>
              <div className="home-skel-row-text">
                <span className="skeleton-bar home-skel-name" />
                <span className="skeleton-bar home-skel-sub" />
              </div>
              <span className="skeleton-bar home-skel-amt" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
