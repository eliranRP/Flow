import { useCallback, useEffect, useRef, useState } from "react";
import { useMercuryConnect } from "../use-mercury-connect";
import { useSumitConnect } from "../use-sumit-connect";
import { useAuth } from "../auth";
import { JEV_DEFAULT, saveJevIntegration } from "../screens/jev-settings";
import { useCompanyForm } from "../screens/company-form";
import { Notice } from "../ui/banner";
import { Button } from "../ui/button";
import { useSheetHistory } from "../ui/back";
import { InstallSteps } from "../ui/install-screen";
import type { NotificationPrefs, PushSupport } from "../push";
import { ReviewPushPrompt } from "../screens/review-push-prompt";
import { List, ListRow } from "../ui/list-row";
import { MercuryConnectSheet } from "../ui/mercury-connect-sheet";
import { SumitConnectSheet } from "../ui/sumit-connect-sheet";
import { Toggle } from "../ui/toggle";
import { detectInstallMode, hasInstallPrompt, isStandalone, runInstallPrompt, type InstallMode } from "../ui/install-prompt";
import { useWrite } from "../use-write";
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
  // The same form as onboarding, seeded with the signed-in name.
  const form = useCompanyForm({
    initialName: initialName ?? displayName(session?.user.user_metadata),
    checked: initialName != null,
    onCreated: (companyId) => {
      if (userId) markCompanyCreated(userId);
      onDone(companyId);
    },
  });

  return (
    <SetupStep
      step={0}
      title={STEP_TITLE[0] ?? ""}
      line="השם שיופיע בבית."
      onSubmit={form.submit}
      primary={<Button type="submit" full busy={form.busy}>המשך</Button>}
    >
      {form.fields}
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
  const [importFrom, setImportFrom] = useState<{ touched: boolean; value: string | null }>({ touched: false, value: null });
  const connect = useSumitConnect({
    companyId: companyNumber,
    apiKey,
    setApiKey,
    // Only a touched choice is saved; a new connection already imports from the start.
    importFrom: importFrom.touched ? importFrom.value : undefined,
    onSuccess: () => {
      setConnectSheet(false);
      onConnected();
    },
  });
  const failed = connect.isError;
  // Mercury (FLOW-503) is the second way in, on the same shared connect sheet as Settings.
  const [mercuryOpen, setMercuryOpen] = useState(false);
  const [mercuryKey, setMercuryKey] = useState("");
  // A closed sheet never keeps the key.
  const setMercuryOpenClearing = useCallback((next: boolean) => {
    if (!next) setMercuryKey("");
    setMercuryOpen(next);
  }, []);
  const setMercurySheet = useSheetHistory("mercury-connect", mercuryOpen, setMercuryOpenClearing);
  const mercuryTriggerRef = useRef<HTMLButtonElement>(null);
  const [mercuryImport, setMercuryImport] = useState<{ touched: boolean; value: string | null }>({ touched: false, value: null });
  const mercury = useMercuryConnect({
    apiKey: mercuryKey,
    setApiKey: setMercuryKey,
    importFrom: mercuryImport.touched ? mercuryImport.value : undefined,
    onSuccess: () => {
      setMercurySheet(false);
      onConnected();
    },
  });
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
      secondary={
        <Button type="button" variant="secondary" full buttonRef={mercuryTriggerRef} onClick={() => { setMercurySheet(true); }}>
          חיבור Mercury
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
        importFrom={importFrom.value}
        setImportFrom={(value) => { setImportFrom({ touched: true, value }); }}
        submitLabel="חיבור"
        busy={connect.isPending}
        onSubmit={() => {
          connect.mutate();
        }}
      />
      <MercuryConnectSheet
        open={mercuryOpen}
        onOpenChange={setMercurySheet}
        title="חיבור Mercury"
        returnFocusRef={mercuryTriggerRef}
        apiKey={mercuryKey}
        setApiKey={setMercuryKey}
        importFrom={mercuryImport.value}
        setImportFrom={(value) => { setMercuryImport({ touched: true, value }); }}
        submitLabel="חיבור"
        busy={mercury.isPending}
        onSubmit={() => {
          mercury.mutate();
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

export function StepInstall({
  onBack,
  onSkip,
  onFinish,
  initialMode,
  pushSample,
}: {
  onBack?: () => void;
  onSkip: () => void;
  onFinish: (kind: "ios" | "install") => void;
  /** Stories pass a device. Live reads the browser. */
  initialMode?: InstallMode;
  /** Stories pass the reminder card's answer and push support. Live reads them. */
  pushSample?: { prefs: NotificationPrefs; support: PushSupport };
}) {
  const [mode, setMode] = useState<InstallMode>(() => initialMode ?? detectInstallMode());
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
      <InstallSteps mode={prompt && !standalone ? "android-prompt" : mode} className="ui-setup-steps" />
      {/* FLOW-502: the review card's evening reminder, asked once across both places. */}
      <ReviewPushPrompt
        sample={pushSample?.prefs}
        support={pushSample?.support}
        focusAfter={focusSetupAction}
        iphoneTab="hide"
      />
    </SetupStep>
  );
}

/** The step's own button (סיום or התקנה) takes focus when the reminder card closes. */
function focusSetupAction(): void {
  document.querySelector<HTMLElement>(".ui-setup-cta button")?.focus({ preventScroll: true });
}
