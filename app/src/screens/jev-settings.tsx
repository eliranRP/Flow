import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { getSupabase } from "../lib/supabase";
import { useFocusRowAfterRetry } from "../ui/focus-retry";
import { ConnectorRow } from "../ui/connector-row";
import { ChevronDownIcon, TagIcon } from "../ui/icons";
import { List } from "../ui/list-row";
import { SegmentedControl } from "../ui/segmented-control";
import { TextLink } from "../ui/text-link";
import { Toggle } from "../ui/toggle";
import { useWrite } from "../use-write";
import {
  boundJevConnectorScope,
  jevConnectorOn,
  jevConnectorQueryKey,
  readJevConnectorFlag,
  writeJevConnectorFlag,
} from "./jev-review";

export type JevMode = "off" | "shadow" | "auto";
export type JevStatus = "ready" | "error" | "loading";

export type JevCardState = {
  enabled: boolean;
  mode: JevMode;
  threshold: number;
  status: JevStatus;
  /** The server holds no Jev key (`jev_key_status` said missing): the switch locks off (FLOW-348 A). */
  keyMissing?: boolean;
};

export const JEV_DEFAULT: JevCardState = {
  enabled: false,
  mode: "shadow",
  threshold: 0.9,
  status: "ready",
};

type StoredJev = {
  enabled: boolean;
  mode: JevMode;
  threshold: number;
};

const TITLE = "תיוג חכם (Jev)";
const SHADOW_HINT = "ההצעות נשמרות לבדיקה ולא ממולאות אוטומטית.";
export const AUTO_HINT = "Jev ממלא פרויקט וקטגוריה כשהביטחון מגיע לסף. השורה עדיין ממתינה לאישור, ואפשר לבטל בכרטיס.";

/** FLOW-702 (decision 0145): the two modes a switched-on Jev runs in. */
const MODE_OPTIONS: Array<{ value: "shadow" | "auto"; label: string }> = [
  { value: "shadow", label: "הצעות בלבד" },
  { value: "auto", label: "מילוי אוטומטי" },
];

/** The thresholds auto mode offers, 90% by default (plan FLOW-702). */
export const JEV_THRESHOLDS = [0.8, 0.85, 0.9, 0.95] as const;

function percent(value: number): string {
  return `${String(Math.round(value * 100))}%`;
}

/** On only when the stored row is enabled and not mode off. */
export function jevSwitchOn(state: Pick<JevCardState, "enabled" | "mode" | "status">): boolean {
  return state.status === "ready" && state.enabled && state.mode !== "off";
}

/** FLOW-348 A: with no key on the server the switch locks off. A pending or failed key read never locks it. */
export const JEV_NO_KEY = "צריך מפתח Jev. פונים למנהל המערכת.";

export function jevLocked(state: Pick<JevCardState, "status" | "keyMissing">): boolean {
  return state.status === "ready" && state.keyMissing === true;
}

export function jevStatusWord(state: Pick<JevCardState, "enabled" | "mode" | "status" | "keyMissing">): string {
  if (state.status === "error") return "שגיאה";
  if (jevLocked(state)) return JEV_NO_KEY;
  if (jevSwitchOn(state)) return state.mode === "auto" ? "פעיל · מילוי אוטומטי" : "פעיל · הצעות בלבד";
  return "כבוי";
}

export function formatJevThreshold(value: number): string {
  return roundJevThreshold(value).toFixed(2);
}

/** Two decimal places. A comma is a decimal point. Out of 0.50–1.00 is refused. */
export function parseJevThreshold(value: string): number | null {
  const parsed = Number(value.trim().replace(",", "."));
  if (!Number.isFinite(parsed)) return null;
  const rounded = roundJevThreshold(parsed);
  if (rounded < 0.5 || rounded > 1) return null;
  return rounded;
}

function roundJevThreshold(value: number): number {
  return Math.round(value * 100) / 100;
}

function storedFromRow(data: unknown): StoredJev | null {
  if (data == null) return { enabled: false, mode: "shadow", threshold: 0.9 };
  if (typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.enabled !== "boolean") return null;
  if (row.mode !== "off" && row.mode !== "shadow" && row.mode !== "auto") return null;
  const raw = typeof row.threshold === "number" ? row.threshold : Number(row.threshold);
  if (!Number.isFinite(raw)) return null;
  const threshold = roundJevThreshold(raw);
  if (threshold < 0.5 || threshold > 1) return null;
  return { enabled: row.enabled, mode: row.mode, threshold };
}

export async function readJevIntegration(): Promise<StoredJev> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const { data, error } = await supabase
    .from("company_integrations")
    .select("enabled,mode,threshold")
    .eq("provider", "jev")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const stored = storedFromRow(data);
  if (!stored) throw new Error("validation");
  return stored;
}

/**
 * FLOW-704: whether the server holds a Jev key, "ok" or "missing" (never the key). Null while
 * unknown: a failed or pending read says nothing, so the row keeps its usual word.
 */
export function useJevKeyStatusQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["jev-key-status"],
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<"ok" | "missing" | null> => {
      const supabase = getSupabase();
      if (!supabase) return null;
      const { data, error } = await supabase.rpc("jev_key_status");
      if (error) throw new Error(error.message);
      return data === "ok" || data === "missing" ? data : null;
    },
  });
}

/** The stored Jev row, shared by the Connections page and the Settings חיבורים hint (FLOW-501). */
export function useJevIntegrationQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["jev-integration"],
    enabled,
    retry: false,
    queryFn: readJevIntegration,
  });
}

export async function saveJevIntegration(input: StoredJev): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const { error } = await supabase.rpc("set_company_integration", {
    p_enabled: input.enabled,
    p_mode: input.mode,
    p_threshold: roundJevThreshold(input.threshold),
    p_provider: "jev",
  });
  if (error) throw new Error(error.message);
}

export function JevSettingsCard({
  state,
  busy = false,
  optionsOpen = false,
  retryBusy = false,
  retryRef,
  switchRef,
  onToggle,
  onMode,
  onThreshold,
  onRetry,
  readOnly = false,
  reserveOptions = false,
}: {
  state: JevCardState;
  busy?: boolean;
  optionsOpen?: boolean;
  retryBusy?: boolean;
  retryRef?: Ref<HTMLButtonElement>;
  switchRef?: Ref<HTMLInputElement>;
  /** False when no save started, so nothing is announced (FLOW-704). */
  onToggle?: (enabled: boolean) => boolean | undefined;
  /** הצעות בלבד or מילוי אוטומטי (FLOW-702). */
  onMode?: (mode: "shadow" | "auto") => void;
  onThreshold?: (value: number) => void;
  onRetry?: () => void;
  /** A viewer sees the switch and cannot change it. */
  readOnly?: boolean;
  /** While loading, hold the אפשרויות line only when Jev was last known on (FLOW-704). */
  reserveOptions?: boolean;
}) {
  const panelId = useId();
  const locked = jevLocked(state);
  const shownOn = jevSwitchOn(state) && !locked;
  const showOptions = shownOn;
  const [open, setOpen] = useState(optionsOpen && shownOn);
  const modeHintId = useId();
  const thresholdHintId = useId();
  useEffect(() => {
    if (!showOptions) setOpen(false);
  }, [showOptions]);
  // The hint under the switch is not a live region. After the owner's own tap lands, say the new state once.
  const toggledFrom = useRef<boolean | null>(null);
  const [said, setSaid] = useState("");
  const word = jevStatusWord(state);
  useEffect(() => {
    if (toggledFrom.current == null || busy) return;
    if (state.status === "ready" && shownOn !== toggledFrom.current) setSaid(`${TITLE}: ${word}`);
    toggledFrom.current = null;
  }, [busy, shownOn, state.status, word]);
  // A save does not disable the choices: a focused segment that turns disabled drops focus to the body.
  // Taps while busy are ignored below, the same way the switch stays focusable with aria-busy.
  const auto = state.mode === "auto";
  const threshold = roundJevThreshold(state.threshold);
  const offered = JEV_THRESHOLDS.some((value) => value === threshold);

  const row = state.status === "loading" || state.status === "error" ? (
    <ConnectorRow
      title={TITLE}
      icon={<TagIcon size={24} />}
      state={state.status}
      retry={{ hint: "שגיאה", label: "ניסיון חוזר: תיוג חכם", busy: retryBusy, retryRef, onRetry }}
    />
  ) : (
    <Toggle
      label={TITLE}
      hint={jevStatusWord(state)}
      icon={<TagIcon size={24} />}
      checked={shownOn}
      busy={busy}
      disabled={readOnly}
      locked={locked}
      inputRef={switchRef}
      onChange={(checked) => {
        if (busy || readOnly || locked) return;
        const from = shownOn;
        if (onToggle?.(checked) !== false) toggledFrom.current = from;
      }}
    />
  );

  return (
    <div>
      <List>{row}</List>
      <p className="sr-only" role="status" data-jev-said="">{said}</p>
      {state.status === "loading" ? (
        reserveOptions ? (
          <div className="ui-jev-options" aria-hidden="true">
            <span className="ui-jev-options-reserve" />
          </div>
        ) : null
      ) : showOptions ? (
        <div className="ui-jev-options">
          <TextLink
            chevron={false}
            expanded={open}
            controls={panelId}
            trailing={<ChevronDownIcon size={16} />}
            onClick={() => { setOpen((current) => !current); }}
          >
            אפשרויות
          </TextLink>
          {open ? (
            <div id={panelId} className="ui-jev-options-panel">
              <SegmentedControl
                label="מצב"
                value={auto ? "auto" : "shadow"}
                options={MODE_OPTIONS}
                busy={busy}
                describedBy={modeHintId}
                disabled={readOnly}
                onChange={(mode) => {
                  if (busy || readOnly || mode === (auto ? "auto" : "shadow")) return;
                  onMode?.(mode);
                }}
              />
              <p className="t-hint ui-jev-options-hint" id={modeHintId}>{auto ? AUTO_HINT : SHADOW_HINT}</p>
              {auto ? (
                <>
                  <SegmentedControl
                    label="סף ביטחון"
                    value={offered ? String(threshold) : ""}
                    options={JEV_THRESHOLDS.map((value) => ({ value: String(value), label: percent(value), numeric: true }))}
                    busy={busy}
                    describedBy={offered ? undefined : thresholdHintId}
                    disabled={readOnly}
                    onChange={(value) => {
                      const next = Number(value);
                      if (busy || readOnly || next === threshold) return;
                      onThreshold?.(next);
                    }}
                  />
                  {offered ? null : (
                    <p className="t-hint ui-jev-options-hint" id={thresholdHintId}>
                      {"הסף כרגע "}
                      <bdi className="ui-num" dir="ltr">{percent(threshold)}</bdi>
                    </p>
                  )}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function turnedOn(current: StoredJev, enabled: boolean): StoredJev {
  return {
    enabled,
    mode: enabled && current.mode === "off" ? "shadow" : current.mode,
    threshold: roundJevThreshold(current.threshold),
  };
}

export function JevSettings({
  sample,
  noCompany = false,
  blocked,
  optionsOpen = false,
  readOnly = false,
}: {
  sample?: JevCardState;
  noCompany?: boolean;
  blocked?: () => boolean;
  /** Stories open אפשרויות on first draw. */
  optionsOpen?: boolean;
  readOnly?: boolean;
}) {
  if (noCompany) return null;
  if (sample) return <JevSettingsSample sample={sample} optionsOpen={optionsOpen} readOnly={readOnly} />;
  return <JevSettingsLive blocked={blocked} readOnly={readOnly} />;
}

function JevSettingsSample({ sample, optionsOpen, readOnly }: { sample: JevCardState; optionsOpen: boolean; readOnly: boolean }) {
  const [state, setState] = useState(sample);
  return (
    <JevSettingsCard
      state={state}
      optionsOpen={optionsOpen}
      readOnly={readOnly}
      reserveOptions={sample.enabled && sample.mode !== "off"}
      onToggle={readOnly ? undefined : (enabled) => {
        setState((current) => ({ ...current, ...turnedOn(current, enabled), status: current.status }));
        return true;
      }}
      onMode={readOnly ? undefined : (mode) => { setState((current) => ({ ...current, mode })); }}
      onThreshold={readOnly ? undefined : (threshold) => { setState((current) => ({ ...current, threshold })); }}
      onRetry={() => undefined}
    />
  );
}

function JevSettingsLive({ blocked, readOnly }: { blocked?: () => boolean; readOnly: boolean }) {
  const client = useQueryClient();
  const query = useJevIntegrationQuery(true);
  const keyMissing = useJevKeyStatusQuery(true).data === "missing";
  const save = useWrite<StoredJev>({
    failure: "לא הצלחנו לשמור.",
    keys: ["jev-integration"],
    run: async (next) => {
      await saveJevIntegration(next);
      client.setQueryData(["jev-integration"], next);
      const on = jevConnectorOn(next);
      writeJevConnectorFlag(on);
      client.setQueryData(jevConnectorQueryKey(), on);
      await client.invalidateQueries({ queryKey: jevConnectorQueryKey() });
    },
  });
  // Read once on mount: the cached or remembered connector flag is the last known state.
  const [lastKnownOn] = useState(() => {
    const cached = client.getQueryData<boolean>(jevConnectorQueryKey());
    if (cached !== undefined) return cached;
    const scope = boundJevConnectorScope();
    return scope != null && readJevConnectorFlag(scope) === true;
  });
  const retryRef = useRef<HTMLButtonElement>(null);
  const switchRef = useRef<HTMLInputElement>(null);
  const retrying = useRef(false);
  const [retryingView, setRetryingView] = useState(false);
  const [failureNonce, setFailureNonce] = useState(0);
  const stored: StoredJev | null = query.data ?? null;
  const current = (save.isPending ? save.variables : undefined) ?? stored;
  const reading = current == null;
  const fetchingError = reading && (retrying.current || retryingView);
  const view: JevCardState = !reading
    ? { ...current, status: "ready", keyMissing }
    : fetchingError || !query.isPending
      ? { enabled: false, mode: "shadow", threshold: 0.9, status: "error" }
      : { enabled: false, mode: "shadow", threshold: 0.9, status: "loading" };

  useFocusRowAfterRetry(view.status === "error", retryRef, switchRef, view.status === "ready", failureNonce);

  useEffect(() => {
    if (failureNonce === 0) return;
    const id = window.setTimeout(() => {
      const retry = retryRef.current;
      const active = document.activeElement;
      if (retry == null || active === retry) return;
      if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement) return;
      retry.focus();
    }, 30);
    return () => { window.clearTimeout(id); };
  }, [failureNonce]);

  function retryRead() {
    if (retrying.current) return;
    retrying.current = true;
    setRetryingView(true);
    void query.refetch().then((result) => {
      retrying.current = false;
      setRetryingView(false);
      if (result.isError || result.data == null) setFailureNonce((nonce) => nonce + 1);
    });
  }

  function commit(next: StoredJev): boolean {
    if (readOnly) return false;
    if (blocked?.()) return false;
    if (save.isPending) return false;
    save.mutate(next);
    return true;
  }

  return (
    <JevSettingsCard
      state={view}
      busy={save.isPending}
      readOnly={readOnly}
      reserveOptions={lastKnownOn}
      retryBusy={retryingView}
      retryRef={retryRef}
      switchRef={switchRef}
      onToggle={readOnly ? undefined : (enabled) => {
        if (!stored || save.isPending) return false;
        return commit(turnedOn(stored, enabled));
      }}
      onMode={readOnly ? undefined : (mode) => {
        if (!stored || save.isPending) return;
        commit({ ...stored, mode, threshold: roundJevThreshold(stored.threshold) });
      }}
      onThreshold={readOnly ? undefined : (threshold) => {
        if (!stored || save.isPending) return;
        commit({ ...stored, threshold: roundJevThreshold(threshold) });
      }}
      onRetry={retryRead}
    />
  );
}
