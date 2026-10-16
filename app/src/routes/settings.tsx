import { lazy } from "react";
import { Navigate, Route } from "react-router-dom";
import { screenLoaders } from "../screen-loaders";

const SettingsScreen = lazy(() => screenLoaders.settings().then((m) => ({ default: m.SettingsScreen })));
const ConnectionsScreen = lazy(() => screenLoaders.connections().then((m) => ({ default: m.ConnectionsScreen })));
const NotificationsScreen = lazy(() => screenLoaders.notifications().then((m) => ({ default: m.NotificationsScreen })));
const CategoriesScreen = lazy(() => screenLoaders.categories().then((m) => ({ default: m.CategoriesScreen })));
const TeamScreen = lazy(() => screenLoaders.team().then((m) => ({ default: m.TeamScreen })));
const BusinessScreen = lazy(() => screenLoaders.business().then((m) => ({ default: m.BusinessScreen })));
const SumitConnectionRoute = lazy(() => screenLoaders.connectionPages().then((m) => ({ default: m.SumitConnectionRoute })));
const MercuryConnectionRoute = lazy(() => screenLoaders.connectionPages().then((m) => ({ default: m.MercuryConnectionRoute })));
const AiConnectionPage = lazy(() => screenLoaders.assistant().then((m) => ({ default: m.AiConnectionPage })));

/** The settings tab: its menu, business, categories, connections (with the SUMIT, Mercury and AI pages), notifications and team. The loans pages are in ./loans. */
export function SettingsRoutes() {
  return (
    <>
      {/* FLOW-322 removed the placeholder; FLOW-502's real page is under Settings, so an old link lands there. */}
      <Route path="notifications" element={<Navigate to="/settings/notifications" replace />} />
      <Route path="settings" element={<SettingsScreen />} />
      <Route path="settings/categories" element={<CategoriesScreen />} />
      <Route path="settings/categories/:parentId" element={<CategoriesScreen />} />
      <Route path="settings/business" element={<BusinessScreen />} />
      <Route path="settings/connections" element={<ConnectionsScreen />} />
      <Route path="settings/connections/sumit" element={<SumitConnectionRoute />} />
      <Route path="settings/connections/mercury" element={<MercuryConnectionRoute />} />
      <Route path="settings/connections/ai" element={<AiConnectionPage />} />
      <Route path="settings/notifications" element={<NotificationsScreen />} />
      <Route path="settings/team" element={<TeamScreen />} />
    </>
  );
}
