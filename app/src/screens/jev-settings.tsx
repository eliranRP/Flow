import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { getSupabase } from "../lib/supabase";
import { useFocusRowAfterRetry } from "../ui/focus-retry";
import { AlertIcon, ChevronDownIcon, TagIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { Skeleton } from "../ui/skeleton";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { Toggle } from "../ui/toggle";
import { useWrite } from "../use-write";

export type JevMode = "off" | "shadow";
export type JevStatus = "ready" | "error" | "loading";

export type JevCardState = {
  enabled: boolean;
  mode: JevMode;
  threshold: number;
  status: JevStatus;
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

/** On only when the stored row is enabled and not mode off. */
export function jevSwitchOn(state: Pick<JevCardState, "enabled" | "mode" | "status">): boolean {
  return state.status === "ready" && state.enabled && state.mode !== "off";
}

export function jevStatusWord(state: Pick<JevCardState, "enabled" | "mode" | "status">): string {
  if (state.status === "error") return "שגיאה";
  if (jevSwitchOn(state)) return "פעיל · מצב צל";
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
  if (row.mode !== "off" && row.mode !== "shadow") return null;
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
  showThreshold = false,
  retryBusy = false,
  retryRef,
  switchRef,
  onToggle,
  onThreshold,
  onRetry,
}: {
  state: JevCardState;
  busy?: boolean;
  optionsOpen?: boolean;
  /** The percent field stays hidden until auto mode. Tests still exercise the save. */
  showThreshold?: boolean;
  retryBusy?: boolean;
  retryRef?: Ref<HTMLButtonElement>;
  switchRef?: Ref<HTMLInputElement>;
  onToggle?: (enabled: boolean) => void;
  onThreshold?: (value: number) => void;
  onRetry?: () => void;
}) {
  const panelId = useId();
  const shownOn = jevSwitchOn(state);
  const showOptions = shownOn;
  const [open, setOpen] = useState(optionsOpen && shownOn);
  const [draft, setDraft] = useState(formatJevThreshold(state.threshold));
  const [draftError, setDraftError] = useState(false);
  useEffect(() => {
    if (!showOptions) setOpen(false);
  }, [showOptions]);
  useEffect(() => {
    setDraft(formatJevThreshold(state.threshold));
    setDraftError(false);
  }, [state.threshold]);

  const row = state.status === "loading" ? (
    <ListRow variant="static" title={TITLE} icon={<TagIcon size={24} />} hint={<Skeleton width="sm" />} skelHint busy />
  ) : state.status === "error" ? (
    <ListRow
      variant="static"
      title={TITLE}
      icon={<AlertIcon size={24} />}
      tone="muted"
      describeHint
      hintStatus
      hint="שגיאה"
      action={onRetry ? (
        <TextLink
          size="label"
          chevron={false}
          label="ניסיון חוזר: תיוג חכם"
          busy={retryBusy}
          buttonRef={retryRef}
          onClick={onRetry}
        >
          ניסיון חוזר
        </TextLink>
      ) : undefined}
    />
  ) : (
    <Toggle
      label={TITLE}
      hint={jevStatusWord(state)}
      icon={<TagIcon size={24} />}
      checked={shownOn}
      busy={busy}
      inputRef={switchRef}
      onChange={(checked) => {
        if (busy) return;
        onToggle?.(checked);
      }}
    />
  );

  return (
    <div>
      <List>{row}</List>
      {state.status === "loading" ? (
        <div className="ui-jev-options" aria-hidden="true">
          <span className="ui-jev-options-reserve" />
        </div>
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
            <div id={panelId}>
              <p className="t-hint ui-jev-options-hint">{SHADOW_HINT}</p>
              {showThreshold ? (
                <TextField
                  label="סף"
                  inputMode="decimal"
                  dir="ltr"
                  value={draft}
                  disabled={busy}
                  error={draftError ? "בין 0.50 ל-1.00" : undefined}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setDraftError(false);
                  }}
                  onBlur={() => {
                    if (busy) return;
                    const parsed = parseJevThreshold(draft);
                    if (parsed == null) {
                      setDraftError(true);
                      return;
                    }
                    setDraft(formatJevThreshold(parsed));
                    if (parsed !== roundJevThreshold(state.threshold)) onThreshold?.(parsed);
                  }}
                />
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
  showThreshold = false,
}: {
  sample?: JevCardState;
  noCompany?: boolean;
  blocked?: () => boolean;
  showThreshold?: boolean;
}) {
  if (noCompany) return null;
  if (sample) return <JevSettingsSample sample={sample} showThreshold={showThreshold} />;
  return <JevSettingsLive blocked={blocked} showThreshold={showThreshold} />;
}

function JevSettingsSample({ sample, showThreshold }: { sample: JevCardState; showThreshold: boolean }) {
  const [state, setState] = useState(sample);
  return (
    <JevSettingsCard
      state={state}
      showThreshold={showThreshold}
      onToggle={(enabled) => {
        setState((current) => ({ ...current, ...turnedOn(current, enabled), status: current.status }));
      }}
      onThreshold={(threshold) => { setState((current) => ({ ...current, threshold })); }}
      onRetry={() => undefined}
    />
  );
}

function JevSettingsLive({ blocked, showThreshold }: { blocked?: () => boolean; showThreshold: boolean }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["jev-integration"],
    retry: false,
    queryFn: readJevIntegration,
  });
  const save = useWrite<StoredJev>({
    failure: "לא הצלחנו לשמור.",
    keys: ["jev-integration"],
    run: async (next) => {
      await saveJevIntegration(next);
      client.setQueryData(["jev-integration"], next);
    },
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
    ? { ...current, status: "ready" }
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

  function commit(next: StoredJev) {
    if (blocked?.()) return;
    if (save.isPending) return;
    save.mutate(next);
  }

  return (
    <JevSettingsCard
      state={view}
      busy={save.isPending}
      showThreshold={showThreshold}
      retryBusy={retryingView}
      retryRef={retryRef}
      switchRef={switchRef}
      onToggle={(enabled) => {
        if (!stored || save.isPending) return;
        commit(turnedOn(stored, enabled));
      }}
      onThreshold={(threshold) => {
        if (!stored || save.isPending) return;
        commit({ ...stored, threshold: roundJevThreshold(threshold) });
      }}
      onRetry={retryRead}
    />
  );
}
