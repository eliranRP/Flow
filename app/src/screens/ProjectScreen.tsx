import { Link } from "react-router-dom";
import { Money } from "../components/Money";
import { BackIcon } from "../components/icons";
import { usePreviewSearch } from "../preview";

/** Template A+band. The empty project shows ₪0, isolated as a number. */
export function ProjectScreen() {
  const search = usePreviewSearch();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="band">
        <div className="band-row">
          <Link to={`/projects${search}`} aria-label="חזרה" className="icon-btn icon-btn-on-band">
            <BackIcon />
          </Link>
        </div>
        <div className="band-hero">
          <h1 className="t-title-2">פרויקט</h1>
          <p className="band-label t-label">רווח</p>
          <p className="t-display">
            <Money agorot={0n} />
          </p>
        </div>
      </header>
    </div>
  );
}
