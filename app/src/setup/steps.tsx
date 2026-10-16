import { useState, type SubmitEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "@flow/shared";
import { getSupabase } from "../lib/supabase";
import { JEV_DEFAULT, saveJevIntegration } from "../screens/jev-settings";
import { useCompanyForm } from "../screens/company-form";
import { companyNameError } from "../screens/rename-company";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { CloseIcon } from "../ui/icons";
import { InstallSteps } from "../ui/install-screen";
import { detectInstallMode, isStandalone, type InstallMode } from "../ui/install-prompt";
import { useSheetHistory } from "../ui/back";
import { MercuryConnectSheet } from "../ui/mercury-connect-sheet";
import { SegmentedControl } from "../ui/segmented-control";
import { SumitConnectSheet } from "../ui/sumit-connect-sheet";
import { TextField } from "../ui/text-field";
import { Toggle } from "../ui/toggle";
import { useMercuryConnect } from "../use-mercury-connect";
import { useSumitConnect } from "../use-sumit-connect";
import { assertNoError } from "../use-write";
import { pushSupport, subscribeThisDevice } from "../push";
import { type ConnectKind, openConnection } from "./connect-entry";
import {
  BASIS_LABEL,
  BASIS_NOTE,
  BASIS_OPTIONS,
  BUSINESS_LEAD,
  BUSINESS_NAME_PLACEHOLDER,
  CONNECT_BUSY,
  CONNECT_BUTTON,
  CONNECT_CONNECTED,
  CONNECT_DONE_LABEL,
  CONNECT_LEAD,
  CONNECT_NO_BANK,
  CONNECT_NOTE,
  CONNECT_ROWS,
  CURRENCY_LABEL,
  CURRENCY_OPTIONS,
  INSTALL_FINISH,
  INSTALL_LATER,
  INSTALL_LEAD,
  JEV_HINT,
  JEV_LABEL,
  JEV_LEAD,
  LOAN_ADD_OTHER,
  LOAN_NONE,
  LOAN_NOTE,
  LOAN_PENDING,
  LOANS_LEAD,
  LOANS_SUGGESTED_LABEL,
  NEXT,
  NOTIFY_HINT,
  NOTIFY_LABEL,
  PROJECT_ADD,
  PROJECT_PLACEHOLDER,
  PROJECTS_LEAD,
  REVIEW_BEFORE,
  REVIEW_LEAD,
  REVIEW_SAMPLE_NOTE,
  SAVE_ERROR,
  SKIP_STEP,
  STEP_TITLE,
  SUGGESTED_PROJECTS_LABEL,
  loanPrimary,
  projectsPrimary,
} from "./copy";
import { SampleCard } from "./sample-card";
import { CONNECT_MOVIE, JEV_MOVIE, LOANS_MOVIE, installMovie } from "./movie-scenes";
import { SetupMovie } from "./movie";
import { NewLoanSheet, openNewLoan } from "./loan-entry";
import { OnboardingFrame } from "./shell";
import { useSetupSuggestions } from "./suggestions";
import type { SetupLender, SetupStore } from "./storage";

/** What every step gets from the route. `onDone` saves the patch and goes to the next screen. */
export type StepProps = {
  /** Saves the patch (to the company given, or the current one) and goes to the next screen. */
  onDone: (patch?: Partial<SetupStore>, companyId?: string | null) => void;
  /** Saves stamps without moving on. */
  onStamp: (patch: Partial<SetupStore>) => void;
  onBack?: () => void;
  onSkipStep: () => void;
  onSkipAll: () => Promise<void> | void;
};

/** The company's current values, read by the route. Null while they load. */
export type BusinessInitial = { name: string; currency: "USD" | "ILS"; basis: "paid" | "invoice" };

function nowIso(): string {
  return new Date().toISOString();
}

/** Step 1 · העסק. A new company: create_company, then the general starter set, the currency and the basis. */
export function StepBusiness({
  companyId,
  initial,
  onDone,
  onSkipAll,
}: StepProps & { companyId: string | null; initial: BusinessInitial | null }) {
  const [currency, setCurrency] = useState<"USD" | "ILS">(initial?.currency ?? "USD");
  const [basis, setBasis] = useState<"paid" | "invoice">(initial?.basis ?? "paid");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const client = useQueryClient();
  const form = useCompanyForm({
    initialName: initial?.name ?? "",
    namePlaceholder: BUSINESS_NAME_PLACEHOLDER,
    hideVat: true,
    onCreated: (created) => {
      // create_company succeeded: the first settings follow, then the run starts.
      void (async () => {
        try {
          const supabase = getSupabase();
          if (!supabase) throw new Error("supabase");
          assertNoError(await supabase.rpc("apply_starter_categories", { p_set: "general" }));
          assertNoError(await supabase.rpc("set_company_currency", { p_currency: currency }));
          assertNoError(await supabase.rpc("set_cash_basis", { p_basis: basis }));
          await client.refetchQueries({ queryKey: ["dashboard"], type: "all" });
          const at = nowIso();
          onDone({ run_started_at: at, flow_at: at }, created);
        } catch {
          setFailed(true);
        } finally {
          setSaving(false);
        }
      })();
    },
  });
  const name = form.name;
  const empty = name.trim() === "";

  async function saveExisting(): Promise<void> {
    const supabase = getSupabase();
    if (!supabase || companyId == null) throw new Error("supabase");
    if (initial == null || name.trim() !== initial.name) {
      assertNoError(await supabase.rpc("rename_company", { p_company_id: companyId, p_name: name.trim() }));
    }
    if (initial == null || currency !== initial.currency) {
      assertNoError(await supabase.rpc("set_company_currency", { p_currency: currency }));
    }
    if (initial == null || basis !== initial.basis) {
      assertNoError(await supabase.rpc("set_cash_basis", { p_basis: basis }));
    }
    await client.refetchQueries({ queryKey: ["dashboard"], type: "all" });
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || form.busy) return;
    setFailed(false);
    // The name rule runs first, for both paths (the form shows its message).
    if (companyNameError(name) != null) {
      form.submit(event);
      return;
    }
    if (companyId == null) {
      setSaving(true);
      form.submit(event);
      return;
    }
    setSaving(true);
    void saveExisting()
      .then(() => { onDone(); })
      .catch(() => { setFailed(true); })
      .finally(() => { setSaving(false); });
  }

  return (
    <OnboardingFrame
      step={1}
      title={STEP_TITLE[1] ?? ""}
      lead={BUSINESS_LEAD}
      onSkipAll={onSkipAll}
      primary={
        <Button type="submit" form="setup-business" full disabled={empty} busy={saving || form.busy}>
          {NEXT}
        </Button>
      }
    >
      <form id="setup-business" className="ui-onb-form" onSubmit={submit}>
        {form.fields}
        <div className="ui-onb-field">
          <SegmentedControl
            label={CURRENCY_LABEL}
            value={currency}
            onChange={setCurrency}
            options={CURRENCY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          />
        </div>
        <div className="ui-onb-field">
          <SegmentedControl
            label={BASIS_LABEL}
            value={basis}
            onChange={setBasis}
            options={BASIS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          />
          <p className="ui-onb-note t-hint">{BASIS_NOTE[basis]}</p>
        </div>
        {failed ? <p className="t-hint ui-onb-error" role="alert">{SAVE_ERROR}</p> : null}
      </form>
    </OnboardingFrame>
  );
}

/** Step 2 · חיבור הבנק והספרים. The connect sheets are today's (stand-in for FLOW-512, see connect-entry). */
export function StepConnect({
  mercuryConnected,
  sumitConnected,
  onDone,
  onSkipStep,
  onSkipAll,
  onBack,
}: StepProps & { mercuryConnected: boolean; sumitConnected: boolean }) {
  const connected = mercuryConnected || sumitConnected;
  const [pending, setPending] = useState<ConnectKind | null>(null);

  const [sumitOpen, setSumitOpen] = useState(false);
  const setSumitSheet = useSheetHistory("sumit-connect", sumitOpen, setSumitOpen);
  const [companyNumber, setCompanyNumber] = useState("");
  const [sumitKey, setSumitKey] = useState("");
  const [sumitImport, setSumitImport] = useState<{ touched: boolean; value: string | null }>({ touched: false, value: null });
  const sumit = useSumitConnect({
    companyId: companyNumber,
    apiKey: sumitKey,
    setApiKey: setSumitKey,
    importFrom: sumitImport.touched ? sumitImport.value : undefined,
    onSuccess: () => {
      setSumitSheet(false);
      setPending(null);
    },
  });

  const [mercuryOpen, setMercuryOpen] = useState(false);
  const setMercurySheet = useSheetHistory("mercury-connect", mercuryOpen, setMercuryOpen);
  const [mercuryKey, setMercuryKey] = useState("");
  const [mercuryImport, setMercuryImport] = useState<{ touched: boolean; value: string | null }>({ touched: false, value: null });
  const mercury = useMercuryConnect({
    apiKey: mercuryKey,
    setApiKey: setMercuryKey,
    importFrom: mercuryImport.touched ? mercuryImport.value : undefined,
    onSuccess: () => {
      setMercurySheet(false);
      setPending(null);
    },
  });

  function open(kind: ConnectKind) {
    setPending(kind);
    if (kind === "sumit") setSumitSheet(true);
    else setMercurySheet(true);
  }

  function rowState(kind: ConnectKind, isConnected: boolean) {
    if (isConnected) return { sub: CONNECT_CONNECTED, button: CONNECT_DONE_LABEL, connected: true, busy: false };
    const submitting = kind === "sumit" ? sumit.isPending : mercury.isPending;
    if (pending === kind && submitting) return { sub: CONNECT_BUSY, button: CONNECT_BUSY, connected: false, busy: true };
    return { sub: CONNECT_ROWS[kind].sub, button: CONNECT_BUTTON, connected: false, busy: false };
  }

  return (
    <OnboardingFrame
      step={2}
      title={STEP_TITLE[2] ?? ""}
      lead={CONNECT_LEAD}
      onBack={onBack}
      onSkipAll={onSkipAll}
      primary={
        <Button type="button" full onClick={() => { onDone(); }}>
          {connected ? NEXT : CONNECT_NO_BANK}
        </Button>
      }
      secondary={<Button type="button" variant="link" full onClick={onSkipStep}>{SKIP_STEP}</Button>}
    >
      <SetupMovie scenes={CONNECT_MOVIE.scenes} label={CONNECT_MOVIE.label} />
      <div className="ui-onb-card">
        {(["mercury", "sumit"] as const).map((kind) => {
          const row = rowState(kind, kind === "mercury" ? mercuryConnected : sumitConnected);
          return (
            <div key={kind} className="ui-onb-conn">
              <div className="ui-onb-conn-text">
                <span className="t-name">{CONNECT_ROWS[kind].name}</span>
                <span className={row.connected ? "t-hint ui-onb-good" : "t-hint"}>{row.sub}</span>
              </div>
              {row.connected ? (
                <span className="ui-onb-conn-done t-hint">{CONNECT_DONE_LABEL}</span>
              ) : (
                <Button
                  type="button"
                  variant="pill"
                  busy={row.busy}
                  disabled={pending != null && pending !== kind}
                  onClick={() => { openConnection(kind, open); }}
                >
                  {row.button}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      <p className="t-hint ui-onb-note">{CONNECT_NOTE}</p>
      <SumitConnectSheet
        open={sumitOpen}
        onOpenChange={(next) => { setSumitSheet(next); if (!next) setPending(null); }}
        title="חיבור SUMIT"
        companyId={companyNumber}
        setCompanyId={setCompanyNumber}
        apiKey={sumitKey}
        setApiKey={setSumitKey}
        importFrom={sumitImport.value}
        setImportFrom={(value) => { setSumitImport({ touched: true, value }); }}
        submitLabel="חיבור"
        busy={sumit.isPending}
        onSubmit={() => { sumit.mutate(); }}
      />
      <MercuryConnectSheet
        open={mercuryOpen}
        onOpenChange={(next) => { setMercurySheet(next); if (!next) setPending(null); }}
        title="חיבור Mercury"
        apiKey={mercuryKey}
        setApiKey={setMercuryKey}
        importFrom={mercuryImport.value}
        setImportFrom={(value) => { setMercuryImport({ touched: true, value }); }}
        submitLabel="חיבור"
        busy={mercury.isPending}
        onSubmit={() => { mercury.mutate(); }}
      />
    </OnboardingFrame>
  );
}

/** Step 3 · הפרויקטים. Names only: each added name is saved as a project (upsert_project, as the Projects screen). */
export function StepProjects({
  companyId,
  bankConnected,
  existingNames,
  onDone,
  onSkipStep,
  onSkipAll,
  onBack,
}: StepProps & { companyId: string | null; bankConnected: boolean; existingNames: readonly string[] }) {
  const [draft, setDraft] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const suggestions = useSetupSuggestions(companyId, bankConnected);
  const taken = (name: string) => chips.includes(name) || existingNames.includes(name);
  const trimmed = draft.trim();
  const addable = trimmed.length >= 2 && !taken(trimmed);
  const shown = suggestions.projects.filter((name) => !taken(name));

  function add(name: string) {
    const clean = name.trim();
    if (clean.length < 2 || taken(clean)) return;
    setChips((current) => [...current, clean]);
    setDraft("");
  }

  async function save() {
    setSaving(true);
    setFailed(false);
    try {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      for (const name of chips) {
        assertNoError(await supabase.rpc("upsert_project", { p_name: name, p_status: "active" }));
      }
      onDone({ projects_at: nowIso() });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <OnboardingFrame
      step={3}
      title={STEP_TITLE[3] ?? ""}
      lead={PROJECTS_LEAD}
      onBack={onBack}
      onSkipAll={onSkipAll}
      primary={<Button type="button" full busy={saving} onClick={() => { void save(); }}>{projectsPrimary(chips.length)}</Button>}
      secondary={<Button type="button" variant="link" full onClick={onSkipStep}>{SKIP_STEP}</Button>}
    >
      <form
        className="ui-onb-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (addable) add(trimmed);
        }}
      >
        <div className="ui-onb-add-field">
          <TextField label={PROJECT_PLACEHOLDER} value={draft} onChange={(event) => { setDraft(event.target.value); }} />
        </div>
        <Button type="submit" variant="pill" disabled={!addable}>{PROJECT_ADD}</Button>
      </form>
      {chips.length > 0 ? (
        <div className="ui-onb-chips">
          {chips.map((name) => (
            <span key={name} className="ui-onb-chip ui-onb-chip-added">
              <span>{name}</span>
              <IconButton label="הסרה" className="ui-onb-chip-x" onClick={() => { setChips((current) => current.filter((item) => item !== name)); }}>
                <CloseIcon />
              </IconButton>
            </span>
          ))}
        </div>
      ) : null}
      {shown.length > 0 ? (
        <div className="ui-onb-suggest">
          <p className="t-hint">{SUGGESTED_PROJECTS_LABEL}</p>
          <div className="ui-onb-chips">
            {shown.map((name) => (
              <button key={name} type="button" className="ui-onb-chip ui-onb-chip-suggest" onClick={() => { add(name); }}>
                + {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {failed ? <p className="t-hint ui-onb-error" role="alert">{SAVE_ERROR}</p> : null}
    </OnboardingFrame>
  );
}

/** Step 4 · הלוואות. Lender picks stay in the setup state (the loans table needs a rate and a term). */
export function StepLoans({
  companyId,
  currency,
  bankConnected,
  picks,
  loanCount,
  onPick,
  onDone,
  onSkipStep,
  onSkipAll,
  onBack,
}: StepProps & {
  companyId: string | null;
  currency: "USD" | "ILS";
  bankConnected: boolean;
  picks: SetupLender[];
  loanCount: number;
  onPick: (lender: SetupLender) => void;
}) {
  const suggestions = useSetupSuggestions(companyId, bankConnected);
  const [sheet, setSheet] = useState(false);
  const client = useQueryClient();
  const pickedNames = picks.map((lender) => lender.name);
  const shown = suggestions.lenders.filter((lender) => !pickedNames.includes(lender.name));
  const total = picks.length + loanCount;
  return (
    <OnboardingFrame
      step={4}
      title={STEP_TITLE[4] ?? ""}
      lead={LOANS_LEAD}
      onBack={onBack}
      onSkipAll={onSkipAll}
      primary={
        <Button type="button" full onClick={() => { onDone({ loans_at: nowIso() }); }}>
          {total === 0 ? LOAN_NONE : loanPrimary(total)}
        </Button>
      }
      secondary={total === 0 ? undefined : <Button type="button" variant="link" full onClick={onSkipStep}>{SKIP_STEP}</Button>}
    >
      {total === 0 ? <SetupMovie scenes={LOANS_MOVIE.scenes} label={LOANS_MOVIE.label} /> : null}
      {picks.length > 0 ? (
        <div className="ui-onb-card">
          {picks.map((lender) => (
            <div key={lender.name} className="ui-onb-loan">
              <div className="ui-onb-conn-text">
                <span className="t-name">{lender.name}</span>
                <span className="t-hint">{`משלמים ${formatMoney(BigInt(lender.monthly_agorot), currency)} בחודש · מ־${monthYear(lender.since)}`}</span>
              </div>
              <span className="t-hint ui-onb-pending">{LOAN_PENDING}</span>
            </div>
          ))}
        </div>
      ) : null}
      {shown.length > 0 ? (
        <div className="ui-onb-suggest">
          <p className="t-hint">{LOANS_SUGGESTED_LABEL}</p>
          <div className="ui-onb-chips">
            {shown.map((lender) => (
              <button key={lender.name} type="button" className="ui-onb-chip ui-onb-chip-suggest" onClick={() => { onPick(lender); }}>
                + {lender.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <button type="button" className="ui-onb-add-loan" onClick={() => { openNewLoan(() => { setSheet(true); }); }}>
        {LOAN_ADD_OTHER}
      </button>
      <p className="t-hint ui-onb-note">{LOAN_NOTE}</p>
      <NewLoanSheet
        open={sheet}
        onOpenChange={setSheet}
        companyId={companyId}
        currency={currency}
        onSaved={() => {
          setSheet(false);
          void client.invalidateQueries({ queryKey: ["setup-loans", companyId] });
        }}
      />
    </OnboardingFrame>
  );
}

/** Step 5 · תיוג חכם. The one switch saves as the Jev settings did in the old step. */
export function StepJev({ onDone, onSkipStep, onSkipAll, onBack }: StepProps) {
  const [on, setOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  function save() {
    setSaving(true);
    setFailed(false);
    saveJevIntegration({ enabled: on, mode: on ? JEV_DEFAULT.mode : "off", threshold: JEV_DEFAULT.threshold })
      .then(() => { onDone({ jev_on: on }); })
      .catch(() => { setFailed(true); })
      .finally(() => { setSaving(false); });
  }
  return (
    <OnboardingFrame
      step={5}
      title={STEP_TITLE[5] ?? ""}
      lead={JEV_LEAD}
      onBack={onBack}
      onSkipAll={onSkipAll}
      primary={<Button type="button" full busy={saving} onClick={save}>{NEXT}</Button>}
      secondary={<Button type="button" variant="link" full onClick={onSkipStep}>{SKIP_STEP}</Button>}
    >
      <SetupMovie scenes={JEV_MOVIE.scenes} label={JEV_MOVIE.label} />
      <div className="ui-onb-card ui-onb-switch">
        <Toggle label={JEV_LABEL} hint={JEV_HINT} checked={on} busy={saving} onChange={setOn} />
      </div>
      {failed ? <p className="t-hint ui-onb-error" role="alert">{SAVE_ERROR}</p> : null}
    </OnboardingFrame>
  );
}

/** Step 6 · אישור ראשון. The sample writes nothing: approving only stamps sample_review_at in the setup store. */
export function StepReview({
  approved,
  onStamp,
  onDone,
  onSkipStep,
  onSkipAll,
  onBack,
}: StepProps & { approved: boolean }) {
  const [done, setDone] = useState(approved);
  return (
    <OnboardingFrame
      step={6}
      title={STEP_TITLE[6] ?? ""}
      lead={REVIEW_LEAD}
      onBack={onBack}
      onSkipAll={onSkipAll}
      primary={<Button type="button" full disabled={!done} onClick={() => { onDone(); }}>{done ? NEXT : REVIEW_BEFORE}</Button>}
      secondary={<Button type="button" variant="link" full onClick={onSkipStep}>{SKIP_STEP}</Button>}
    >
      <SampleCard
        approved={done}
        onApprove={() => {
          setDone(true);
          onStamp({ sample_review_at: nowIso() });
        }}
      />
      <p className="t-hint ui-onb-note">{REVIEW_SAMPLE_NOTE}</p>
    </OnboardingFrame>
  );
}

/** Step 7 · מסך הבית. The switch subscribes this device when the browser can push; otherwise nothing is saved. */
export function StepInstall({
  onDone,
  onSkipStep,
  onSkipAll,
  onBack,
  initialMode,
}: StepProps & { initialMode?: InstallMode }) {
  const [notify, setNotify] = useState(true);
  const [saving, setSaving] = useState(false);
  const mode = initialMode ?? detectInstallMode();
  return (
    <OnboardingFrame
      step={7}
      title={STEP_TITLE[7] ?? ""}
      lead={INSTALL_LEAD}
      onBack={onBack}
      onSkipAll={onSkipAll}
      primary={
        <Button
          type="button"
          full
          busy={saving}
          onClick={() => {
            setSaving(true);
            void (async () => {
              if (notify && pushSupport() === "ok") await subscribeThisDevice();
              onDone({ installed_at: nowIso() });
            })().finally(() => { setSaving(false); });
          }}
        >
          {INSTALL_FINISH}
        </Button>
      }
      secondary={<Button type="button" variant="link" full onClick={onSkipStep}>{INSTALL_LATER}</Button>}
    >
      <SetupMovie scenes={installMovie().scenes} label="סרטון קצר" />
      <div className="ui-onb-card ui-onb-switch">
        <Toggle label={NOTIFY_LABEL} hint={NOTIFY_HINT} checked={notify} onChange={setNotify} />
      </div>
      {isStandalone() ? null : <InstallSteps mode={mode} className="ui-onb-install" />}
    </OnboardingFrame>
  );
}

/** "07/10"-style: the month and the two-digit year of an ISO date. */
export function monthYear(iso: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return `${match[2] ?? ""}/${(match[1] ?? "").slice(2)}`;
}

