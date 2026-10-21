import { Link } from "react-router-dom";
import { useRefreshingNow } from "../israel-clock";
import { israelUsePhrase } from "../sumit-copy";
import { Button } from "../ui/button";
import { ConnectionFacts, ConnectionHead, ConnectionNote } from "../ui/connection-page";
import { BackIcon, KeyIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { activeKeys, clientLabel, keyDate, keyName, scopeChoice, scopeLabel, type AssistantKey } from "./assistant-keys";

export const LIST_NOTE = "מפתח לכל עוזר ולכל מכשיר. ביטול מפתח אחד לא נוגע באחרים. כל פעולה נרשמת עם שם המפתח, ואפשר לבטל אותה כמו כל שינוי אחר.";
const KEY_NOTE = "כל פעולה של העוזר נרשמת עם שם המפתח, ואפשר לבטל אותה כמו כל שינוי אחר.";
const NOT_USED = "עוד לא בשימוש";
const USE_LEAD = "שימוש אחרון";

/** "‹ כל המפתחות": back to the key list from a key's page or from a new key's setup. */
export function AllKeysLink({ to, onClick }: { to: string; onClick?: () => void }) {
  return (
    <Link className="ui-ai-all-keys" to={to} onClick={onClick}>
      <BackIcon size={16} />
      כל המפתחות
    </Link>
  );
}

/** The access at a row's end: accent for read and write, grey for read only, signal once the key expired. */
function accessValue(key: AssistantKey) {
  if (key.expired) return <span className="ui-row-value-signal">פג תוקף</span>;
  const scope = scopeChoice(key.scope);
  return scope === "read_write" ? <span className="ui-row-value-accent">{scopeLabel(scope)}</span> : scopeLabel(scope);
}

/**
 * "מפתחות פעילים · N" (board: SettingsMcpKeys): one row per key (its name, its last use, the access),
 * "+ מפתח חדש", and the line on keys per assistant and device. Expired keys stay listed after the
 * active ones until they are revoked.
 */
export function KeyList({
  keys,
  keyTo,
  newKeyTo,
}: {
  keys: readonly AssistantKey[];
  keyTo: (key: AssistantKey) => string;
  /** Null for someone who cannot add a key. */
  newKeyTo: string | null;
}) {
  const [now] = useRefreshingNow();
  return (
    <>
      <ConnectionHead>{`מפתחות פעילים · ${String(activeKeys(keys).length)}`}</ConnectionHead>
      <List className="ui-ai-keys">
        {keys.map((key) => (
          <ListRow
            key={key.id}
            variant="item"
            href={keyTo(key)}
            icon={<KeyIcon size={22} />}
            title={keyName(key)}
            hint={israelUsePhrase(key.last_used_at, now) ?? NOT_USED}
            value={accessValue(key)}
            chevron
          />
        ))}
      </List>
      {newKeyTo != null ? <Button variant="secondary" to={newKeyTo}>+ מפתח חדש</Button> : null}
      <ConnectionNote>{LIST_NOTE}</ConnectionNote>
    </>
  );
}

/** A key's page (board: SettingsMcpKey): its name and access, then עוזר, שימוש אחרון, נוצר and בתוקף עד; ביטול המפתח. */
export function KeyPage({
  apiKey,
  listTo,
  onRevoke,
  revoking,
}: {
  apiKey: AssistantKey;
  listTo: string;
  /** Null for someone who cannot revoke. */
  onRevoke: (() => void) | null;
  revoking: boolean;
}) {
  const [now] = useRefreshingNow();
  const used = israelUsePhrase(apiKey.last_used_at, now);
  const assistant = clientLabel(apiKey.client);
  const made = keyDate(apiKey.created_at);
  const until = keyDate(apiKey.expires_at);
  return (
    <>
      <AllKeysLink to={listTo} />
      <div className="ui-settings-card ui-connection-card ui-ai-connected-card">
        <p className="ui-ai-status">
          <span className="ui-ai-status-name">{keyName(apiKey)}</span>
          <span className="ui-ai-status-scope">{scopeLabel(scopeChoice(apiKey.scope))}</span>
        </p>
        <ConnectionFacts
          rows={[
            ...(assistant != null ? [{ label: "עוזר", value: assistant }] : []),
            { label: USE_LEAD, value: used == null ? NOT_USED : used.slice(USE_LEAD.length).trim() },
            ...(made != null ? [{ label: "נוצר", value: made, ltr: true }] : []),
            ...(until != null
              ? [{ label: "בתוקף עד", value: apiKey.expired ? <span className="ui-row-value-signal">{until}</span> : until, ltr: true }]
              : []),
          ]}
        />
        <p className="ui-ai-code-note">{KEY_NOTE}</p>
      </div>
      {onRevoke != null ? (
        <div className="ui-connection-actions">
          <Button variant="danger-link" busy={revoking} onClick={onRevoke}>ביטול המפתח</Button>
        </div>
      ) : null}
    </>
  );
}
