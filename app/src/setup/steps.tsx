import { useEffect, useId, useRef, useState, type ReactNode, type SubmitEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { getSupabase } from "../lib/supabase";
import { saveJevIntegration } from "../screens/jev-settings";
import { Button } from "../ui/button";
import { List, ListRow } from "../ui/list-row";
import { SegmentedControl } from "../ui/segmented-control";
import { TextField } from "../ui/text-field";
import { Toggle } from "../ui/toggle";
import { TagIcon } from "../ui/icons";
import { detectInstallMode, hasInstallPrompt, isStandalone, runInstallPrompt, type InstallMode } from "../ui/install-prompt";
import { assertNoError, useWrite } from "../use-write";
import { useCategoriesQuery, useDashboardQuery } from "../use-books";
import { CountTitle, NameHint } from "./card";
import {
  DEFAULT_CATEGORY_NAMES,
  DEMO_ALT,
  DEMO_ALT_ANDROID,
  JEV_HINT,
  NO_PROJECTS_HINT,
  SAVE_ERROR,
  STEP_TITLE,
  SUMIT_FAILURE_LINE,
  SUMIT_FAILURE_TITLE,
  VAT_HINT,
  categoryTitle,
  nameHint,
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

export function StepBusiness({ userId, onDone }: { userId: string | null; onDone: (companyId: string) => void }) {
  const { session } = useAuth();
  const client = useQueryClient();
  const seeded = displayName(session?.user.user_metadata);
  const [name, setName] = useState(seeded);
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
        label="שם העסק"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
        required
        minLength={2}
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
  return (
    <div className="ui-setup-note" role="status">
      <p className="ui-setup-note-title">{SUMIT_FAILURE_TITLE}</p>
      <p className="t-hint">{SUMIT_FAILURE_LINE}</p>
    </div>
  );
}

export function StepSumit({
  failed,
  onConnect,
  onBack,
  onSkip,
}: {
  failed: boolean;
  onConnect: () => void;
  onBack?: () => void;
  onSkip: () => void;
}) {
  return (
    <SetupStep
      step={1}
      title={STEP_TITLE[1] ?? ""}
      line="ההכנסות וההוצאות נכנסות לבד."
      demoAlt={DEMO_ALT[1]}
      onBack={onBack}
      onSkip={onSkip}
      primary={<Button type="button" full onClick={onConnect}>{failed ? "ניסיון חוזר" : "חיבור SUMIT"}</Button>}
    >
      {failed ? <SumitFailureNote /> : null}
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
    keys: ["setup-jev"],
    onSuccess: onSaved,
    run: async () => {
      await saveJevIntegration({ enabled: on, mode: on ? "shadow" : "off", threshold: 0.9 });
    },
  });
  return (
    <SetupStep
      step={2}
      title={STEP_TITLE[2] ?? ""}
      line="Flow יציע פרויקט וקטגוריה לכל תנועה."
      demoAlt={DEMO_ALT[2]}
      onBack={onBack}
      onSkip={onSkip}
      primary={<Button type="button" full busy={save.isPending} onClick={() => { save.mutate(); }}>המשך</Button>}
    >
      <Toggle
        icon={<TagIcon size={24} />}
        label="תיוג חכם (Jev)"
        hint={JEV_HINT}
        checked={on}
        busy={save.isPending}
        onChange={setOn}
      />
    </SetupStep>
  );
}

export function StepLists({
  sumitConnected,
  onBack,
  onSkip,
  onConfirm,
}: {
  sumitConnected: boolean;
  onBack?: () => void;
  onSkip: () => void;
  onConfirm: () => void;
}) {
  const dashboard = useDashboardQuery();
  const categories = useCategoriesQuery();
  const projects = (dashboard.data?.projects ?? []).map((project) => project.name).filter((name) => name !== "");
  const loaded = categories.data?.map((row) => row.name).filter((name) => name !== "") ?? [];
  const names = !categories.isLoading && loaded.length === 0 ? [...DEFAULT_CATEGORY_NAMES] : loaded;
  const projectHint = nameHint(projects, 2);
  const categoryHint = nameHint(names, 3);
  return (
    <SetupStep
      step={3}
      title={STEP_TITLE[3] ?? ""}
      line={sumitConnected ? "הגיעו מ־SUMIT. אפשר לשנות אחר כך." : "עוד אין פרויקטים. אפשר להוסיף אחר כך."}
      demoAlt={DEMO_ALT[3]}
      onBack={onBack}
      onSkip={onSkip}
      primary={<Button type="button" full onClick={onConfirm}>נראה טוב</Button>}
    >
      <List>
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
      demoAlt={DEMO_ALT[4]}
      onBack={onBack}
      onSkip={onSkip}
      primary={<Button type="button" full onClick={onOpen}>{empty ? "כרטיס דוגמה" : "לאישור"}</Button>}
    />
  );
}

function installRows(mode: InstallMode): ReactNode {
  if (mode === "android-prompt") return null;
  if (mode === "android-steps") {
    return (
      <ol className="ui-setup-steps">
        <li>מקישים על <bdi dir="ltr">⋮</bdi> בתפריט של הדפדפן</li>
        <li>בוחרים ״הוספה למסך הבית״</li>
        <li>מאשרים ״הוספה״</li>
      </ol>
    );
  }
  return (
    <ol className="ui-setup-steps">
      <li>מקישים <bdi dir="ltr">•••</bdi> בספארי</li>
      <li>שיתוף ואז הוספה למסך הבית</li>
      <li>מקישים הוספה</li>
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
  useEffect(() => {
    function onPrompt() {
      if (hasInstallPrompt()) setMode(detectInstallMode());
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    function onInstalled() {
      onFinish("install");
    }
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [onFinish]);
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
      demoAlt={iphone ? DEMO_ALT[5] : DEMO_ALT_ANDROID}
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
        ) : null
      }
    >
      <p className="sr-only">הכתובת בספארי היא <bdi dir="ltr">{host}</bdi>.</p>
      {installRows(prompt && !standalone ? "android-prompt" : mode)}
    </SetupStep>
  );
}
