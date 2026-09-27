import { Link } from "react-router-dom";
import { BackIcon } from "./icons";

/** Template A: the title only. A back control is for screens that are not tab roots. */
export function PageTitle({ title, backTo }: { title: string; backTo?: string }) {
  return (
    <div className="page">
      {backTo ? (
        <Link to={backTo} aria-label="חזרה" className="icon-btn">
          <BackIcon />
        </Link>
      ) : null}
      <h1 className="t-title-1">{title}</h1>
    </div>
  );
}
