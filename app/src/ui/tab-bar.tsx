import { NavLink, useLocation } from "react-router-dom";
import { addTriggerRef } from "../add-trigger";
import { usePreviewSearch } from "../preview";
import { withSheetBackground } from "../sheet-background";
import { HomeIcon, PlusIcon, ProjectsIcon, ReviewIcon, SettingsIcon } from "./icons";

const slot = "tab-slot";

type TabBarProps = {
  label?: string;
  reviewCount?: number;
};

export function TabBar({ label = "ניווט ראשי", reviewCount = 0 }: TabBarProps) {
  const search = usePreviewSearch();
  const location = useLocation();
  const badge = reviewCount > 99 ? "99+" : String(reviewCount);
  return (
    <nav className="tabbar" aria-label={label}>
      <div className="tabbar-slots">
        <NavLink to={`/${search}`} end className={slot}>
          <span className="tab-icon">
            <HomeIcon />
          </span>
          בית
        </NavLink>
        <NavLink to={`/projects${search}`} className={slot}>
          <span className="tab-icon">
            <ProjectsIcon />
          </span>
          פרויקטים
        </NavLink>
        <NavLink
          ref={addTriggerRef}
          to={`/add${search}`}
          state={withSheetBackground(location)}
          aria-label="הוספה"
          className={`${slot} tab-slot-fab`}
        >
          <span className="fab">
            <PlusIcon />
          </span>
        </NavLink>
        <NavLink
          to={`/review${search}`}
          className={slot}
          aria-label={reviewCount > 0 ? `לאישור, ${badge} ממתינים` : undefined}
        >
          <span className="tab-icon">
            <ReviewIcon />
            {reviewCount > 0 ? <span className="count-badge">{badge}</span> : null}
          </span>
          לאישור
        </NavLink>
        <NavLink to={`/settings${search}`} className={slot}>
          <span className="tab-icon">
            <SettingsIcon />
          </span>
          הגדרות
        </NavLink>
      </div>
    </nav>
  );
}
