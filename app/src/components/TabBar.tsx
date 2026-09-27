import { NavLink } from "react-router-dom";
import { usePreviewSearch } from "../preview";
import { HomeIcon, PlusIcon, ProjectsIcon, ReviewIcon, SettingsIcon } from "./icons";

const slot = "tab-slot";

export function TabBar() {
  const search = usePreviewSearch();
  return (
    <nav className="tabbar" aria-label="ניווט ראשי">
      <div className="tabbar-slots">
        <NavLink to={`/${search}`} end className={slot}>
          <HomeIcon />
          בית
        </NavLink>
        <NavLink to={`/projects${search}`} className={slot}>
          <ProjectsIcon />
          פרויקטים
        </NavLink>
        <NavLink to={`/add${search}`} aria-label="הוספה" className={`${slot} tab-slot-fab`}>
          <span className="fab">
            <PlusIcon />
          </span>
        </NavLink>
        <NavLink to={`/review${search}`} className={slot}>
          <ReviewIcon />
          לאישור
        </NavLink>
        <NavLink to={`/settings${search}`} className={slot}>
          <SettingsIcon />
          הגדרות
        </NavLink>
      </div>
    </nav>
  );
}
