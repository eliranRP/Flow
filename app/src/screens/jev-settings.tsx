import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { getSupabase } from "../lib/supabase";
import { RadioRow } from "../ui/radio-row";
import { Skeleton } from "../ui/skeleton";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { Toggle } from "../ui/toggle";

export type JevMode = "off" | "shadow";
export type JevStatus = "connected" | "missing-key" | "error" | "loading";

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
  status: "connected",
};

type StoredJev = {
  enabled: boolean;
  mode: JevMode;
  threshold: number;
};

const TITLE = "תיוג חכם (Jev)";

export function jevStatusWord(status: JevStatus): string {
  if (status === "missing-key") return "אין מפתח";
  if (status === "error") return "שגיאה";
  return "מחובר";
}

export function formatJevThreshold(value: number): string {
  return value.toFixed(2);
}

export function parseJevThreshold(value: string): number | null {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0.5 || parsed > 1) return null;
  return parsed;
}

function storedFromRow(data: unknown): StoredJev | null {
  if (data == null) return { enabled: false, mode: "shadow", threshold: 0.9 };
  if (typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.enabled !== "boolean") return null;
  if (row.mode !== "off" && row.mode !== "shadow") return null;
  const threshold = typeof row.threshold === "number" ? row.threshold : Number(row.threshold);
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) return null;
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
    p_threshold: input.threshold,
    p_provider: "jev",
  });
  if (error) throw new Error(error.message);
}

export function JevSettingsCard({
  state,
  busy = false,
  optionsOpen = false,
  onToggle,
  onMode,
  onThreshold,
  onRetry,
}: {
  state: JevCardState;
  busy?: boolean;
  optionsOpen?: boolean;
  onToggle?: (enabled: boolean) => void;
  onMode?: (mode: JevMode) => void;
  onThreshold?: (value: number) => void;
  onRetry?: () => void;
}) {
  const panelId = useId();
  const actionable = state.status === "connected" && !busy;
  const showOptions = actionable && state.enabled;
  const [open, setOpen] = useState(optionsOpen);
  const [draft, setDraft] = useState(formatJevThreshold(state.threshold));
  const [draftError, setDraftError] = useState(false);
  useEffect(() => {
    if (!showOptions) setOpen(false);
  }, [showOptions]);
  useEffect(() => {
    setDraft(formatJevThreshold(state.threshold));
    setDraftError(false);
  }, [state.threshold]);

  const hint = state.status === "loading"
    ? <Skeleton width="sm" />
    : jevStatusWord(state.status);

  return (
    <div className="ui-page-pad ui-stack">
      <Toggle
        label={TITLE}
        hint={hint}
        checked={state.enabled}
        disabled={!actionable}
        onChange={(checked) => {
          if (!actionable) return;
          onToggle?.(checked);
        }}
      />
      {state.status === "error" && onRetry ? (
        <TextLink size="label" chevron={false} label="ניסיון חוזר: תיוג חכם" onClick={onRetry}>
          ניסיון חוזר
        </TextLink>
      ) : null}
      {showOptions ? (
        <TextLink
          chevron={false}
          expanded={open}
          controls={panelId}
          onClick={() => { setOpen((current) => !current); }}
        >
          אפשרויות
        </TextLink>
      ) : null}
      {showOptions && open ? (
        <div id={panelId}>
          <div role="radiogroup" aria-label="מצב">
            <RadioRow
              marker="start"
              label="צל"
              selected={state.mode === "shadow"}
              onSelect={() => { onMode?.("shadow"); }}
            />
          </div>
          <TextField
            label="סף"
            inputMode="decimal"
            dir="ltr"
            value={draft}
            error={draftError ? "בין 0.50 ל-1.00" : undefined}
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftError(false);
            }}
            onBlur={() => {
              const parsed = parseJevThreshold(draft);
              if (parsed == null) {
                setDraftError(true);
                return;
              }
              setDraft(formatJevThreshold(parsed));
              if (parsed !== state.threshold) onThreshold?.(parsed);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function turnedOn(current: StoredJev, enabled: boolean): StoredJev {
  return {
    enabled,
    mode: enabled && current.mode === "off" ? "shadow" : current.mode,
    threshold: current.threshold,
  };
}

export function JevSettings({
  sample,
  noCompany = false,
  blocked,
}: {
  sample?: JevCardState;
  noCompany?: boolean;
  blocked?: () => boolean;
}) {
  if (noCompany) return null;
  if (sample) return <JevSettingsSample sample={sample} />;
  return <JevSettingsLive blocked={blocked} />;
}

function JevSettingsSample({ sample }: { sample: JevCardState }) {
  const [state, setState] = useState(sample);
  return (
    <JevSettingsCard
      state={state}
      onToggle={(enabled) => {
        setState((current) => ({ ...current, ...turnedOn(current, enabled), status: current.status }));
      }}
      onMode={(mode) => { setState((current) => ({ ...current, mode })); }}
      onThreshold={(threshold) => { setState((current) => ({ ...current, threshold })); }}
      onRetry={() => undefined}
    />
  );
}

function JevSettingsLive({ blocked }: { blocked?: () => boolean }) {
  const toast = useToast();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["jev-integration"],
    retry: false,
    queryFn: readJevIntegration,
  });
  const [pending, setPending] = useState<StoredJev | null>(null);
  const [busy, setBusy] = useState(false);
  const stored: StoredJev | null = query.data ?? null;
  const view: JevCardState = query.isPending
    ? { ...JEV_DEFAULT, status: "loading" }
    : query.isError || stored == null
      ? { ...JEV_DEFAULT, enabled: false, status: "error" }
      : { ...(pending ?? stored), status: "connected" };

  async function commit(next: StoredJev) {
    if (blocked?.()) return;
    setPending(next);
    setBusy(true);
    try {
      await saveJevIntegration(next);
      client.setQueryData(["jev-integration"], next);
      setPending(null);
    } catch {
      setPending(null);
      toast.show({ tone: "bad", message: "לא הצלחנו לשמור." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <JevSettingsCard
      state={view}
      busy={busy}
      onToggle={(enabled) => {
        if (!stored) return;
        void commit(turnedOn(pending ?? stored, enabled));
      }}
      onMode={(mode) => {
        if (!stored) return;
        const current = pending ?? stored;
        if (current.mode === mode) return;
        void commit({ ...current, mode });
      }}
      onThreshold={(threshold) => {
        if (!stored) return;
        void commit({ ...(pending ?? stored), threshold });
      }}
      onRetry={() => { void query.refetch(); }}
    />
  );
}
