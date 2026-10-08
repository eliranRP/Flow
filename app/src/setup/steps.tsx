import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { useSumitConnect } from "../use-sumit-connect";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { getSupabase } from "../lib/supabase";
import { JEV_DEFAULT, saveJevIntegration } from "../screens/jev-settings";
import { COMPANY_NAME_MAX, companyNameError } from "../screens/rename-company";
import { Notice } from "../ui/banner";
import { Button } from "../ui/button";
import { useSheetHistory } from "../ui/back";
import { ANDROID_INSTALL_STEPS, IOS_INSTALL_STEPS } from "../ui/install-copy";
import { List, ListRow } from "../ui/list-row";
import { SegmentedControl } from "../ui/segmented-control";
import { SumitConnectSheet } from "../ui/sumit-connect-sheet";
import { TextField } from "../ui/text-field";
import { Toggle } from "../ui/toggle";
import { detectInstallMode, hasInstallPrompt, isStandalone, runInstallPrompt, type InstallMode } from "../ui/install-prompt";
import { assertNoError, useWrite } from "../use-write";
import { useCategoriesQuery, useDashboardQuery } from "../use-books";
import { CountTitle, NameHint } from "./card";
import {
  DEFAULT_CATEGORY_NAMES,
  JEV_HINT,
  NO_PROJECTS_HINT,
  SAVE_ERROR,
  STEP_TITLE,
  SUMIT_FAILURE_LINE,
  SUMIT_FAILURE_TITLE,
  VAT_HINT,
  categoryTitle,
  nameHint,
  visibleCategoryNames,
  projectTitle,
  reviewLine,
  setupHost,
} from "./copy";
import { SetupStep } from "./shell";
import { markCompanyCreated } from "./storage";

function displayName(metadata: unknown): string {
  if (metadata == null || typeof metadata !== "object") return "";
  const row = metadata as { full_name?: unknown; name?: unknown };
  if (typeof row.full_name === "string" && row.full_name.trim() !== "") return row.full_name.trim();
  if (typeof row.name === "string" && row.name.trim() !== "") return row.name.trim();
  return "";
}

export function StepBusiness({
  userId,
  onDone,
  initialName,
}: {
  userId: string | null;
  onDone: (companyId: string) => void;
  /** A story opens on a typed name, checked as if the field had been left. */
  initialName?: string;
}) {
  const { session } = useAuth();
  const client = useQueryClient();
  const seeded = displayName(session?.user.user_metadata);
  const [name, setName] = useState(initialName ?? seeded);
  const [error, setError] = useState(() => (initialName == null ? undefined : companyNameError(initialName)));
  const fieldRef = useRef<HTMLInputElement>(null);
  const [vat, setVat] = useState<"registered" | "exempt">("registered");
  const hintId = useId();
  const created = useRef<string | null>(null);
  const save = useWrite({
    failure: SAVE_ERROR,
    keys: ["home", "dashboard", "sumit"],
    onSuccess: () => {
      if (userId) markCompanyCreated(userId);
      const companyId = created.current;
      if (companyId) onDone(companyId);
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase.rpc("create_company", { p_name: name.trim(), p_vat_registered: vat === "registered" });
      assertNoError(result);
      if (typeof result.data !== "string" || result.data === "") throw new Error("validation");
      created.current = result.data;
      await client.refetchQueries({ queryKey: ["dashboard"], type: "all" });
    },
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    // The create_company rule (FLOW-606), on the field instead of a save toast.
    const problem = companyNameError(name);
    setError(problem);
    if (problem) {
      fieldRef.current?.focus();
      return;
    }
    save.mutate();
  }

  return (
    <SetupStep
      step={0}
      title={STEP_TITLE[0] ?? ""}
      line="השם שיופיע בבית."
      onSubmit={submit}
      primary={<Button type="submit" full busy={save.isPending}>המשך</Button>}
    >
      <TextField
        ref={fieldRef}
        label="שם העסק"
        value={name}
        maxLength={COMPANY_NAME_MAX + 20}
        error={error}
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError(undefined);
        }}
        onBlur={() => {
          setError(companyNameError(name));
        }}
      />
      <SegmentedControl
        label="סוג העסק"
        describedBy={hintId}
        value={vat}
        onChange={setVat}
        options={[
          { value: "registered", label: "עוסק מורשה" },
          { value: "exempt", label: "עוסק פטור" },
        ]}
      />
      <p id={hintId} className="t-hint">{vat === "registered" ? VAT_HINT.registered : VAT_HINT.exempt}</p>
    </SetupStep>
  );
}

export function SumitFailureNote() {
  return <Notice tone="bad" title={SUMIT_FAILURE_TITLE} body={SUMIT_FAILURE_LINE} />;
}

export function StepSumit({
  onConnected,
  onBack,
  onSkip,
}: {
  onConnected: () => void;
  onBack?: () => void;
  onSkip: () => void;
}) {
  const [open, setOpen] = useState(false);
  const setConnectSheet = useSheetHistory("sumit-connect", open, setOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [companyNumber, setCompanyNumber] = useState("");
  const [apiKey, setApiKey] = useState("");
  const connect = useSumitConnect({
    companyId: companyNumber,
    apiKey,
    setApiKey,
    onSuccess: () => {
      setConnectSheet(false);
      onConnected();
    },
  });
  const failed = connect.isError;
  return (
    <SetupStep
      step={1}
      title={STEP_TITLE[1] ?? ""}
      line="ההכנסות וההוצאות נכנסות לבד."
      demo="sumit"
      onBack={onBack}
      onSkip={onSkip}
      primary={
        <Button type="button" full buttonRef={triggerRef} onClick={() => { setConnectSheet(true); }}>
          {failed ? "ניסיון חוזר" : "חיבור SUMIT"}
        </Button>
      }
    >
      {failed && !open ? <SumitFailureNote /> : null}
      <SumitConnectSheet
        open={open}
        onOpenChange={setConnectSheet}
        title="חיבור SUMIT"
        returnFocusRef={triggerRef}
        companyId={companyNumber}
        setCompanyId={setCompanyNumber}
        apiKey={apiKey}
        setApiKey={setApiKey}
        submitLabel="חיבור"
        busy={connect.isPending}
        onSubmit={() => {
          connect.mutate();
        }}
      />
    </SetupStep>
  );
}

export function StepJev({
  onBack,
  onSkip,
  onSaved,
}: {
  onBack?: () => void;
  onSkip: () => void;
  onSaved: () => void;
}) {
  const [on, setOn] = useState(true);
  const save = useWrite({
    failure: SAVE_ERROR,
    keys: ["setup-jev", "jev-integration"],
    onSuccess: onSaved,
    run: async () => {
      await saveJevIntegration({ enabled: on, mode: on ? JEV_DEFAULT.mode : "off", threshold: JEV_DEFAULT.threshold });
    },
  });
  return (
    <SetupStep
      step={2}
      title={STEP_TITLE[2] ?? ""}
      line="Flow יציע פרויקט וקטגוריה לכל תנועה."
      demo="jev"
      onBack={onBack}
      onSkip={onSkip}
      primary={<Button type="button" full busy={save.isPending} onClick={() => { save.mutate(); }}>המשך</Button>}
    >
      <div className="ui-setup-jev">
        <Toggle
          label={"תיוג חכם \u2066(Jev)\u2069"}
          hint={JEV_HINT}
          checked={on}
          busy={save.isPending}
          onChange={setOn}
        />
      </div>
    </SetupStep>
  );
}

export function StepLists({
  onBack,
  onSkip,
  onConfirm,
}: {
  onBack?: () => void;
  onSkip: () => void;
  onConfirm: () => void;
}) {
  const dashboard = useDashboardQuery();
  const categories = useCategoriesQuery();
  const projects = (dashboard.data?.projects ?? []).map((project) => project.name).filter((name) => name !== "");
  const loaded = visibleCategoryNames(categories.data ?? []);
  const names = !categories.isLoading && (categories.data?.length ?? 0) === 0 ? [...DEFAULT_CATEGORY_NAMES] : loaded;
  const projectHint = nameHint(projects, 2);
  const categoryHint = nameHint(names, 3);
  return (
    <SetupStep
      step={3}
      title={STEP_TITLE[3] ?? ""}
      line={projects.length > 0 ? "הגיעו מ־SUMIT. אפשר לשנות אחר כך." : "עוד אין פרויקטים. אפשר להוסיף אחר כך."}
      demo="projects"
      onBack={onBack}
      onSkip={onSkip}
      primary={<Button type="button" full onClick={onConfirm}>נראה טוב</Button>}
    >
      <List className="ui-setup-panel">
        <ListRow
          variant="item"
          href="/projects"
          chevron
          describeHint
          wrapHint
          title={projects.length === 0 ? projectTitle(0) : <CountTitle count={projects.length} one={projectTitle(1)} many="פרויקטים" />}
          label={projectTitle(projects.length)}
          hint={projects.length === 0 ? NO_PROJECTS_HINT : <NameHint head={projectHint.head} rest={projectHint.rest} />}
        />
        <ListRow
          variant="item"
          href="/settings/categories"
          chevron
          describeHint
          wrapHint
          title={categories.isLoading ? "קטגוריות" : <CountTitle count={names.length} one={categoryTitle(1)} many="קטגוריות" />}
          label={categories.isLoading ? "קטגוריות" : categoryTitle(names.length)}
          hint={categories.isLoading || names.length === 0 ? undefined : <NameHint head={categoryHint.head} rest={categoryHint.rest} />}
          skelHint={categories.isLoading}
        />
      </List>
    </SetupStep>
  );
}

export function StepReview({
  count,
  onBack,
  onSkip,
  onOpen,
}: {
  count: number;
  onBack?: () => void;
  onSkip: () => void;
  onOpen: () => void;
}) {
  const empty = count <= 0;
  return (
    <SetupStep
      step={4}
      title={STEP_TITLE[4] ?? ""}
      line={empty ? "עוד אין תנועות. נסו על כרטיס דוגמה." : count === 1 ? reviewLine(1) : (
        <>
          <bdi className="ui-num" dir="ltr">{String(count)}</bdi> תנועות מחכות. אישור הוא הקשה אחת.
        </>
      )}
      demo="approval"
      onBack={onBack}
      onSkip={onSkip}
      primary={<Button type="button" full onClick={onOpen}>{empty ? "כרטיס דוגמה" : "לאישור"}</Button>}
    />
  );
}

function installRows(mode: InstallMode): ReactNode {
  if (mode === "android-prompt") return null;
  const steps = mode === "android-steps" ? ANDROID_INSTALL_STEPS : IOS_INSTALL_STEPS;
  return (
    <ol className="ui-setup-steps">
      {steps.map((step, index) => (
        <li key={step.id}>
          <span className="ui-setup-stepn" aria-hidden="true">{String(index + 1)}</span>
          <span>{step.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function StepInstall({
  onBack,
  onSkip,
  onFinish,
}: {
  onBack?: () => void;
  onSkip: () => void;
  onFinish: (kind: "ios" | "install") => void;
}) {
  const [mode, setMode] = useState<InstallMode>(() => detectInstallMode());
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  useEffect(() => {
    function onPrompt() {
      if (hasInstallPrompt()) setMode(detectInstallMode());
    }
    function onInstalled() {
      onFinishRef.current("install");
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const iphone = mode === "iphone" || mode === "iphone-other" || mode === "ipad";
  const prompt = mode === "android-prompt";
  const standalone = isStandalone();
  // The Safari drawing reads this host. It is the page host, never a stand-in.
  const host = setupHost();
  return (
    <SetupStep
      step={5}
      title={STEP_TITLE[5] ?? ""}
      line="Flow נפתח ממסך הבית, במסך מלא."
      demo={iphone ? "ios" : "android"}
      onBack={onBack}
      onSkip={onSkip}
      primary={
        iphone || standalone ? (
          <Button type="button" full onClick={() => { onFinish(iphone ? "ios" : "install"); }}>סיום</Button>
        ) : prompt ? (
          <Button
            type="button"
            full
            onClick={() => {
              void runInstallPrompt().then((started) => {
                if (started) onFinish("install");
              });
            }}
          >
            התקנה
          </Button>
        ) : (
          <Button type="button" full onClick={() => { onFinish("install"); }}>סיום</Button>
        )
      }
    >
      <p className="sr-only">הכתובת בספארי היא <bdi dir="ltr">{host}</bdi>.</p>
      {installRows(prompt && !standalone ? "android-prompt" : mode)}
    </SetupStep>
  );
}
