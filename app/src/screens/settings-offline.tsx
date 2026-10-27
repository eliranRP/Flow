import { BandOfflineLine, useOnline } from "../ui/band-states";

/** FLOW-972: what an offline settings page says. A write made offline waits and runs when the connection is back. */
export const SETTINGS_OFFLINE = "שינויים יישמרו כשהחיבור יחזור";

/** Offline, a settings page says under its head that changes wait for the connection (decision 0222). */
export function SettingsOfflineLine() {
  const online = useOnline();
  return online ? null : <BandOfflineLine onPage words={SETTINGS_OFFLINE} />;
}
