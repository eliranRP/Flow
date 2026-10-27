import { useCallback, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useDashboardQuery } from "../use-books";
import { useHoldOwnerSettings, ViewerNote, ViewerScope } from "../use-is-viewer";
import { Button } from "../ui/button";
import { ConnectionNote, ConnectionPage } from "../ui/connection-page";
import { ScreenState } from "../ui/screen-state";
import { useBlockedPreview } from "./screen-shared";
import { screenPhase } from "../query-phase";
import {
  activeKeys,
  addedToast,
  keyName,
  restoreKey,
  revokeKey,
  useAssistantStatusQuery,
  type AssistantClient,
  type AssistantKey,
  type AssistantSample,
  type Minted,
} from "./assistant-keys";
import { KeyList, KeyPage } from "./assistant-key-views";
import { AssistantSetup } from "./assistant-setup";
import { useTopToast } from "../ui/top-toast";

const TITLE = "חיבור ל־AI";
const SUBTITLE = "MCP · העוזר שלכם עובד עם הספרים של Flow";
const EXPIRED_BOX = "הקוד פג אחרי 90 יום. צרו מפתח חדש כדי להמשיך.";
const REVOKE_FAILED = "לא הצלחנו לבטל את המפתח. נסו שוב.";
const RESTORE_FAILED = "לא הצלחנו להחזיר את המפתח.";

type View = { kind: "home" } | { kind: "new" } | { kind: "key"; id: string };
type Added = { id: string; name: string; client: AssistantClient; scope: string[] };

/** The page under the AI path: the list (or the setup with no key), `/new`, or `/key/<id>`. */
function viewOf(pathname: string, basePath: string): View {
  const rest = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : "";
  if (rest === "/new") return { kind: "new" };
  const key = /^\/key\/([^/]+)$/.exec(rest)?.[1];
  return key != null ? { kind: "key", id: decodeURIComponent(key) } : { kind: "home" };
}

/** A key added in a story or the dev route: the sample lists it as the server would. */
function sampleKey(added: Added): AssistantKey {
  const now = new Date();
  return {
    id: added.id,
    name: added.name,
    client: added.client,
    scope: added.scope,
    created_at: now.toISOString(),
    last_used_at: null,
    expires_at: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    expired: false,
  };
}

/**
 * The AI connection page (FLOW-512, FLOW-939). With no key it is the setup. Once there is a key it
 * opens on the key list; a key's page shows its facts and revokes it (a toast with undo); a new key
 * runs the setup with a name on top. A secret is shown once and lives only in the setup's memory.
 */
export function AiConnectionPage({
  sample,
  sampleSecret,
  initialSecret,
  initialClient = "claude-code",
  blocked,
  readOnly,
  basePath = "/settings/connections/ai",
}: {
  sample?: AssistantSample;
  /** A preview mint shows this secret. Stories and the dev route pass it. */
  sampleSecret?: string;
  initialSecret?: Minted;
  initialClient?: AssistantClient;
  blocked?: () => boolean;
  /** Read-only for the viewer and editor: the page shows the keys, not the actions. */
  readOnly?: boolean;
  /** Where the list lives; the dev route passes its own. */
  basePath?: string;
}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  // Every toast on the connection pages sits under the header (decisions 0222, 0223).
  const toast = useTopToast();
  const localBlocked = useBlockedPreview();
  const guard = blocked ?? localBlocked;
  const holdOwner = useHoldOwnerSettings();
  const dashboard = useDashboardQuery(sample == null);
  const liveNoCompany = sample == null && preview === "off" && dashboard.isSuccess && dashboard.data.company_id == null;
  const readonly = readOnly ?? holdOwner;
  const [sampleKeys, setSampleKeys] = useState<AssistantKey[] | null>(null);
  const [revoking, setRevoking] = useState(false);
  // While a new code is on screen the list is read every few seconds, so the first call finishes the setup.
  const [polling, setPolling] = useState(false);
  // A first key's code stays on screen after the key joins the list, until סיום or "כל המפתחות".
  const [holding, setHolding] = useState(false);
  const status = useAssistantStatusQuery(sample == null && !liveNoCompany && preview === "off", polling);
  const view = viewOf(location.pathname, basePath);
  // Moving between the list, a key and a new key keeps the query (a preview, or the dev fixture's sample).
  const here = location.search;
  const listTo = `${basePath}${here}`;
  const keys: AssistantKey[] = sample != null ? (sampleKeys ?? sample.keys ?? []) : (status.data?.keys ?? []);
  const state: AssistantSample["state"] = sample != null
    ? sample.state
    : liveNoCompany
      ? "no-company"
      : status.isError && status.data == null
        ? "error"
        : status.data?.state ?? "loading";

  const onAdded = useCallback((added: Added) => {
    setPolling(false);
    setHolding(false);
    let active: number;
    if (sample != null) {
      const next = [...(sampleKeys ?? sample.keys ?? []), sampleKey(added)];
      setSampleKeys(next);
      active = activeKeys(next).length;
    } else {
      const listed = client.getQueryData<{ keys?: AssistantKey[] }>(["mcp-status"])?.keys ?? [];
      active = activeKeys(listed).length + (listed.some((key) => key.id === added.id) ? 0 : 1);
    }
    toast.show({ tone: "info", message: addedToast(active) });
    void navigate(listTo);
  }, [sample, sampleKeys, client, toast, navigate, listTo]);

  const backTo = `/settings/connections${search}`;
  if (state === "loading" || state === "error" || (sample == null && dashboard.isLoading)) {
    const phase = state === "error"
      ? ({ kind: "error", offline: !navigator.onLine } as const)
      : state === "loading" ? ({ kind: "loading" } as const) : screenPhase(preview, dashboard);
    const retry = state === "loading" || state === "error" ? () => { void status.refetch(); } : () => { void dashboard.refetch(); };
    return <ScreenState title={TITLE} kicker="חיבורים" backTo={backTo} phase={phase} onRetry={retry} />;
  }
  if (state === "no-company") {
    return (
      <ViewerScope>
      <ConnectionPage title={TITLE} subtitle={SUBTITLE} backTo={backTo}>
        <div className="ui-stack">
          <p>כדי לחבר עוזר צריך עסק.</p>
          <Button variant="link" to="/setup/1" chevron>פרטי העסק</Button>
        </div>
      </ConnectionPage>
      </ViewerScope>
    );
  }
  if (readonly && keys.length === 0) {
    return (
      <ViewerScope>
      <ConnectionPage title={TITLE} subtitle={SUBTITLE} backTo={backTo}>
        <ViewerNote />
        <ConnectionNote>רק בעל העסק יכול לחבר את העוזר.</ConnectionNote>
      </ConnectionPage>
      </ViewerScope>
    );
  }

  async function revoke(key: AssistantKey) {
    if (revoking || guard()) return;
    const message = `המפתח בוטל · ${keyName(key)}`;
    if (sample != null) {
      const before = keys;
      setSampleKeys(keys.filter((item) => item.id !== key.id));
      void navigate(listTo);
      toast.show({ tone: "info", message, action: "ביטול", onAction: () => { setSampleKeys(before); } });
      return;
    }
    setRevoking(true);
    try {
      await revokeKey(key.id);
      await client.invalidateQueries({ queryKey: ["mcp-status"] });
      void navigate(listTo);
      toast.show({
        tone: "info",
        message,
        action: "ביטול",
        onAction: () => {
          void restoreKey(key.id)
            .catch(() => { toast.show({ tone: "bad", message: RESTORE_FAILED }); })
            .finally(() => client.invalidateQueries({ queryKey: ["mcp-status"] }));
        },
      });
    } catch {
      toast.show({ tone: "bad", message: REVOKE_FAILED });
    } finally {
      setRevoking(false);
    }
  }

  const opened = view.kind === "key" ? keys.find((key) => key.id === view.id) : undefined;
  if (view.kind === "key" && opened == null) return <Navigate to={listTo} replace />;
  const setup = view.kind === "new" || keys.length === 0 || (holding && view.kind === "home");
  if (view.kind === "new" && readonly) return <Navigate to={listTo} replace />;

  return (
    <ViewerScope>
    <ConnectionPage
      title={TITLE}
      subtitle={SUBTITLE}
      backTo={backTo}
      problem={!setup && opened == null && state === "expired" ? EXPIRED_BOX : undefined}
    >
      <ViewerNote />
      {opened != null ? (
        <KeyPage apiKey={opened} listTo={listTo} revoking={revoking} onRevoke={readonly ? null : () => { void revoke(opened); }} />
      ) : setup ? (
        <AssistantSetup
          keys={keys}
          allKeysTo={keys.length > 0 ? listTo : null}
          sample={sample != null}
          sampleSecret={sampleSecret}
          initialSecret={initialSecret}
          initialClient={initialClient}
          guard={guard}
          onMinted={() => {
            // The new key is listed at once; the setup stays on screen while its code is shown.
            setPolling(true);
            setHolding(true);
          }}
          onLeave={() => {
            setPolling(false);
            setHolding(false);
          }}
          onAdded={onAdded}
        />
      ) : (
        <KeyList
          keys={keys}
          keyTo={(key) => `${basePath}/key/${encodeURIComponent(key.id)}${here}`}
          newKeyTo={readonly ? null : `${basePath}/new${here}`}
        />
      )}
    </ConnectionPage>
    </ViewerScope>
  );
}
