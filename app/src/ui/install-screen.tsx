import { useEffect, useRef, type ReactNode } from "react";
import { AppIcon, BellIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, DownloadIcon, HomeIcon, ShareIcon, SquarePlusIcon } from "./icons";
import { IconButton } from "./icon-button";
import { Button } from "./button";
import { ListRow } from "./list-row";
import { runInstallPrompt } from "./install-prompt";
import { useToast } from "./toast";

export type InstallMode = "android-prompt" | "android-steps" | "iphone" | "iphone-other" | "ipad";

const exampleLabel = "נתוני דוגמה · Example data";

const benefits = [
  { icon: <HomeIcon size={24} />, title: "פתיחה במגע אחד", hint: "מסך הבית, במסך מלא" },
  { icon: <BellIcon size={24} />, title: "שתי התראות בלבד", hint: "סיכום שבועי ותזכורת לאישור" },
  { icon: <DownloadIcon size={24} />, title: "בלי חנות אפליקציות", hint: "מתעדכן לבד" },
];

export function InstallScreen({
  mode,
  example = false,
  onDismiss,
  onInstall,
}: {
  mode: InstallMode;
  /** Stories show the mockup tag. A live offer omits it. */
  example?: boolean;
  onDismiss: () => void;
  /** Replaces the saved beforeinstallprompt. Stories use this to observe the tap. */
  onInstall?: () => void;
}) {
  const toast = useToast();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const android = mode === "android-prompt" || mode === "android-steps";
  const shareHint = mode === "ipad" ? "כפתור השיתוף נמצא למעלה" : "כפתור השיתוף נמצא למטה";

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function install() {
    if (onInstall) {
      onInstall();
      return;
    }
    await runInstallPrompt();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.show({ message: "הקישור הועתק" });
    } catch {
      toast.show({ tone: "bad", message: "לא הצלחנו להעתיק את הקישור." });
    }
  }

  return (
    <section className="ui-install">
      <div className="ui-install-scroll">
        <div className="ui-install-top">
          {example ? <span className="t-hint">{exampleLabel}</span> : null}
          <IconButton label="סגירה" onClick={onDismiss}>
            <CloseIcon />
          </IconButton>
        </div>
        <header className="ui-install-hero">
          <AppIcon />
          <h1 ref={titleRef} className="t-title-1" tabIndex={-1}>
            {android ? <>התקנת <bdi dir="ltr">Flow</bdi></> : "הוספה למסך הבית"}
          </h1>
          <p className="ui-install-sub">
            {mode === "iphone-other"
              ? "ההתקנה באייפון עובדת רק מספארי."
              : android
                ? "נפתח כמו אפליקציה, ישר ממסך הבית."
                : "באייפון זה נעשה מספארי, בשלושה צעדים."}
          </p>
        </header>
        {mode === "android-prompt" ? <BenefitList /> : null}
        {mode === "android-steps" ? <StepList steps={androidSteps} /> : null}
        {mode === "iphone" || mode === "ipad" ? <StepList steps={safariSteps} /> : null}
        {mode === "iphone-other" ? <StepList steps={[{ id: "safari", text: "פותחים את הקישור הזה בספארי" }]} /> : null}
      </div>
      <div className="ui-install-cta">
        {mode === "iphone" || mode === "ipad" ? (
          <p className="ui-install-hint">
            <span>{shareHint}</span>
            <span aria-hidden="true">{mode === "ipad" ? <ChevronUpIcon size={22} /> : <ChevronDownIcon size={22} />}</span>
          </p>
        ) : null}
        {mode === "android-prompt" ? (
          <>
            <Button full icon={<DownloadIcon size={20} />} onClick={() => { void install(); }}>התקנה</Button>
            <Button variant="ghost" full quiet className="ui-install-later" onClick={onDismiss}>לא עכשיו</Button>
          </>
        ) : null}
        {mode === "iphone-other" ? (
          <Button variant="secondary" full onClick={() => { void copyLink(); }}>העתקת קישור</Button>
        ) : null}
        {mode !== "android-prompt" ? (
          <Button variant="secondary" full onClick={onDismiss}>הבנתי</Button>
        ) : null}
      </div>
    </section>
  );
}

function BenefitList() {
  return (
    <div className="ui-install-benefits">
      {benefits.map((benefit) => (
        <ListRow key={benefit.title} variant="static" icon={benefit.icon} title={benefit.title} hint={benefit.hint} />
      ))}
    </div>
  );
}

type Step = {
  id: string;
  text: ReactNode;
};

const safariSteps: Step[] = [
  {
    id: "share",
    text: (
      <>
        מקישים על <InlineTile icon={<ShareIcon size={18} />}>״שיתוף״</InlineTile> בסרגל של ספארי
      </>
    ),
  },
  {
    id: "add",
    text: (
      <>
        בוחרים <InlineTile icon={<SquarePlusIcon size={18} />}>״הוסף למסך הבית״</InlineTile>
      </>
    ),
  },
  { id: "confirm", text: <>מקישים <strong>״הוסף״</strong> בפינה העליונה</> },
];

const androidSteps: Step[] = [
  { id: "menu", text: "מקישים על ⋮ בתפריט של הדפדפן" },
  { id: "choose", text: <>בוחרים <strong>״הוספה למסך הבית״</strong></> },
  { id: "accept", text: <>מאשרים <strong>״הוספה״</strong></> },
];

function StepList({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="ui-install-steps">
      {steps.map((step, index) => (
        <li className="ui-install-step" key={step.id}>
          <span className="ui-install-num" aria-hidden="true">{String(index + 1)}</span>
          <span className="ui-install-step-text">{step.text}</span>
        </li>
      ))}
    </ol>
  );
}

function InlineTile({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <span className="ui-install-unit">
      <span className="ui-install-tile" aria-hidden="true">{icon}</span>
      <strong>{children}</strong>
    </span>
  );
}
