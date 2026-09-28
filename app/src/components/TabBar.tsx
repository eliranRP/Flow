import { NavLink, useLocation } from "react-router-dom";
import { addTriggerRef } from "../add-trigger";
import { usePreviewSearch } from "../preview";
import { withSheetBackground } from "../sheet-background";
import { HomeIcon, PlusIcon, ProjectsIcon, ReviewIcon, SettingsIcon } from "./icons";

const slot = "tab-slot";

export function TabBar() {
  const search = usePreviewSearch();
  const location = useLocation();
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
