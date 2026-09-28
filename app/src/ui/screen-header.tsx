import { IconButton } from "./icon-button";
import { BackIcon } from "./icons";

/** One title block for every screen. A back control is for screens that are not tab roots. */
export function ScreenHeader({ title, subtitle, backTo }: { title: string; subtitle?: string; backTo?: string }) {
  return (
    <header className="page">
      {backTo ? (
        <IconButton label="חזרה" to={backTo}>
          <BackIcon />
        </IconButton>
      ) : null}
      <h1 className="t-title-1">{title}</h1>
      {subtitle ? <p className="t-label mt-4 text-text-secondary">{subtitle}</p> : null}
    </header>
  );
}
