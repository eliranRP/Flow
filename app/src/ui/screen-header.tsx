import { Link } from "react-router-dom";
import { BackIcon } from "./icons";

export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="page">
      <h1 className="t-title-1">{title}</h1>
      {subtitle ? <p className="t-label mt-4 text-text-secondary">{subtitle}</p> : null}
    </header>
  );
}

/** Template A title. A back control is for screens that are not tab roots. */
export function PageTitle({ title, backTo }: { title: string; backTo?: string }) {
  return (
    <div className="page">
      {backTo ? (
        <Link to={backTo} aria-label="חזרה" className="icon-btn ui-icon-btn">
          <BackIcon />
        </Link>
      ) : null}
      <h1 className="t-title-1">{title}</h1>
    </div>
  );
}
