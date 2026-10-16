import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const SettingsScreen = lazy(() => screenLoaders.settings().then((m) => ({ default: m.SettingsScreen })));
const ConnectionsScreen = lazy(() => screenLoaders.connections().then((m) => ({ default: m.ConnectionsScreen })));
const NotificationsScreen = lazy(() => screenLoaders.notifications().then((m) => ({ default: m.NotificationsScreen })));
const CategoriesScreen = lazy(() => screenLoaders.categories().then((m) => ({ default: m.CategoriesScreen })));
const TeamScreen = lazy(() => screenLoaders.team().then((m) => ({ default: m.TeamScreen })));

/** The settings tab: its list, categories, connections, notifications and team. The loans pages are in ./loans. */
export function SettingsRoutes() {
  return (
    <>
      {/* FLOW-322 removed the placeholder; FLOW-502's real page is under Settings, so an old link lands there. */}
      <Route path="notifications" element={<Navigate to="/settings/notifications" replace />} />
      <Route path="settings" element={<SettingsScreen />} />
      <Route path="settings/categories" element={<CategoriesScreen />} />
      <Route path="settings/categories/:parentId" element={<CategoriesScreen />} />
      <Route path="settings/connections" element={<ConnectionsScreen />} />
      <Route path="settings/notifications" element={<NotificationsScreen />} />
      <Route path="settings/team" element={<TeamScreen />} />
    </>
  );
}
