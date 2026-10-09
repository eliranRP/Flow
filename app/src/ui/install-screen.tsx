import type { ReactNode } from "react";
import { FocusTitle } from "./focus-title";
import { AppIcon, CloseIcon, DownloadIcon, HomeIcon } from "./icons";
import { IconButton } from "./icon-button";
import { Button } from "./button";
import { ANDROID_INSTALL_STEPS, iosBrowser, iosInstallLead, iosInstallSteps, type InstallStepCopy, type IosBrowser } from "./install-copy";
import { ListRow } from "./list-row";
import { runInstallPrompt, type InstallMode } from "./install-prompt";

export type { InstallMode };

const benefits = [
  { icon: <HomeIcon size={24} />, title: "פתיחה במגע אחד", hint: "מסך הבית, במסך מלא" },
  { icon: <DownloadIcon size={24} />, title: "בלי חנות אפליקציות", hint: "מתעדכן לבד" },
];

export function InstallScreen({
  mode,
  example,
  onDismiss,
  onInstall,
  browser,
}: {
  mode: InstallMode;
  /** The iPhone browser whose steps to show. Live reads the user agent; stories pass one. */
  browser?: IosBrowser;
  /** Stories pass the mockup tag. A live offer omits it. */
  example?: ReactNode;
  onDismiss: () => void;
  /** Replaces the saved beforeinstallprompt. Stories use this to observe the tap. */
  onInstall?: () => void;
}) {
  const android = mode === "android-prompt" || mode === "android-steps";
  // Safari's steps on an iPhone or iPad Safari; Chrome and Firefox on iPhone get their own.
  const ios = mode === "iphone-other" ? (browser ?? iosBrowser()) : "safari";

  async function install() {
    if (onInstall) {
      onInstall();
      return;
    }
    await runInstallPrompt();
  }

  return (
    <section className="ui-install">
      <div className="ui-install-scroll">
        <div className="ui-install-top">
          <IconButton label="סגירה" onClick={onDismiss}>
            <CloseIcon />
          </IconButton>
          {example}
        </div>
        <header className="ui-install-hero">
          <AppIcon />
          <FocusTitle className="t-title-1">
            {android ? <>התקנת <bdi dir="ltr">Flow</bdi></> : "הוספה למסך הבית"}
          </FocusTitle>
          <p className="ui-install-sub">
            {android ? "נפתח כמו אפליקציה, ישר ממסך הבית." : iosInstallLead(ios)}
          </p>
        </header>
        {mode === "android-prompt" ? <BenefitList /> : null}
        {mode === "android-steps" ? <StepList steps={ANDROID_INSTALL_STEPS} /> : null}
        {mode === "iphone" || mode === "ipad" || mode === "iphone-other" ? <StepList steps={iosInstallSteps(ios)} /> : null}
      </div>
      <div className="ui-install-cta">
        {mode === "android-prompt" ? (
          <>
            <Button full icon={<DownloadIcon size={20} />} onClick={() => { void install(); }}>התקנה</Button>
            <Button variant="ghost" full quiet className="ui-install-later" onClick={onDismiss}>לא עכשיו</Button>
          </>
        ) : (
          <Button variant="secondary" full onClick={onDismiss}>הבנתי</Button>
        )}
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

function StepList({ steps }: { steps: readonly InstallStepCopy[] }) {
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

