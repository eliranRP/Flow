import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { getSupabase } from "../lib/supabase";
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
  onToggle,
  onThreshold,
  onRetry,
}: {
  state: JevCardState;
  busy?: boolean;
  optionsOpen?: boolean;
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

  const hint = state.status === "loading"
    ? <Skeleton width="sm" />
    : jevStatusWord(state);

  return (
    <div className="ui-page-pad ui-stack">
      <Toggle
        label={TITLE}
        hint={hint}
        checked={shownOn}
        disabled={state.status !== "ready" || busy}
        onChange={(checked) => {
          if (state.status !== "ready" || busy) return;
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
          <p>צל</p>
          <p className="t-hint">{SHADOW_HINT}</p>
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
      onThreshold={(threshold) => { setState((current) => ({ ...current, threshold })); }}
      onRetry={() => undefined}
    />
  );
}

function JevSettingsLive({ blocked }: { blocked?: () => boolean }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["jev-integration"],
    retry: false,
    queryFn: readJevIntegration,
  });
  const [pending, setPending] = useState<StoredJev | null>(null);
  const wanted = useRef<StoredJev | null>(null);
  const saving = useRef(false);
  const save = useWrite({
    failure: "לא הצלחנו לשמור.",
    keys: ["jev-integration"],
    run: async () => {
      const next = wanted.current;
      if (!next) throw new Error("missing");
      await saveJevIntegration(next);
      client.setQueryData(["jev-integration"], next);
    },
  });
  const stored: StoredJev | null = query.data ?? null;
  const current = pending ?? stored;
  const view: JevCardState = query.isPending
    ? { enabled: false, mode: "shadow", threshold: 0.9, status: "loading" }
    : query.isError || current == null
      ? { enabled: false, mode: "shadow", threshold: 0.9, status: "error" }
      : { ...current, status: "ready" };

  function commit(next: StoredJev) {
    if (blocked?.()) return;
    if (saving.current || save.isPending) return;
    saving.current = true;
    wanted.current = next;
    setPending(next);
    save.mutate(undefined, {
      onSettled: () => {
        saving.current = false;
        setPending(null);
      },
    });
  }

  return (
    <JevSettingsCard
      state={view}
      busy={save.isPending}
      onToggle={(enabled) => {
        if (!stored && !pending) return;
        const base = pending ?? stored;
        if (!base) return;
        commit(turnedOn(base, enabled));
      }}
      onThreshold={(threshold) => {
        const base = pending ?? stored;
        if (!base) return;
        commit({ ...base, threshold: roundJevThreshold(threshold) });
      }}
      onRetry={() => { void query.refetch(); }}
    />
  );
}
