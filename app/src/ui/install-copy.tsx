import type { ReactNode } from "react";

/**
 * Shared by setup step 5 and the later install offer (17b).
 * iOS 26 Hebrew Safari labels (•••, שיתוף, הוספה למסך הבית, Open as Web App
 * drawn as פתיחה כאפליקציה, הוספה, and Compact / Bottom / Top tab layouts)
 * still need a check on a real device before release.
 */
export type InstallStepCopy = {
  id: string;
  text: ReactNode;
};

export const IOS_INSTALL_STEPS: readonly InstallStepCopy[] = [
  { id: "menu", text: <>מקישים <bdi dir="ltr">•••</bdi> בספארי</> },
  { id: "share", text: "שיתוף ואז הוספה למסך הבית" },
  { id: "add", text: "מקישים הוספה" },
];

export const ANDROID_INSTALL_STEPS: readonly InstallStepCopy[] = [
  { id: "menu", text: <>מקישים על <bdi dir="ltr">⋮</bdi> בתפריט של הדפדפן</> },
  { id: "choose", text: "בוחרים ״הוספה למסך הבית״" },
  { id: "accept", text: "מאשרים ״הוספה״" },
];

/** The iPhone browser, from its user agent: Chrome (CriOS) and Firefox (FxiOS) have their own share paths. */
export type IosBrowser = "safari" | "chrome" | "firefox" | "other";

export function iosBrowser(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): IosBrowser {
  if (/CriOS/.test(ua)) return "chrome";
  if (/FxiOS/.test(ua)) return "firefox";
  if (/EdgiOS|OPiOS/.test(ua) || !/Safari/.test(ua)) return "other";
  return "safari";
}

/**
 * FLOW-502 follow-up: Chrome and Firefox on iPhone add to the Home Screen from their own share
 * button, not Safari's •••. These labels also need a check on a real device before release.
 */
export const IOS_CHROME_INSTALL_STEPS: readonly InstallStepCopy[] = [
  { id: "share", text: "מקישים על סמל השיתוף בשורת הכתובת" },
  { id: "choose", text: "בוחרים ״הוספה למסך הבית״" },
  { id: "add", text: "מקישים הוספה" },
];

export const IOS_FIREFOX_INSTALL_STEPS: readonly InstallStepCopy[] = [
  { id: "menu", text: <>מקישים על <bdi dir="ltr">☰</bdi> בתפריט של Firefox</> },
  { id: "share", text: "שיתוף ואז הוספה למסך הבית" },
  { id: "add", text: "מקישים הוספה" },
];

export const IOS_OTHER_INSTALL_STEPS: readonly InstallStepCopy[] = [
  { id: "share", text: "מקישים על סמל השיתוף של הדפדפן" },
  { id: "choose", text: "בוחרים ״הוספה למסך הבית״" },
  { id: "add", text: "מקישים הוספה" },
];

export function iosInstallSteps(browser: IosBrowser): readonly InstallStepCopy[] {
  if (browser === "chrome") return IOS_CHROME_INSTALL_STEPS;
  if (browser === "firefox") return IOS_FIREFOX_INSTALL_STEPS;
  if (browser === "other") return IOS_OTHER_INSTALL_STEPS;
  return IOS_INSTALL_STEPS;
}

/** The line under the install title on an iPhone. */
export function iosInstallLead(browser: IosBrowser): ReactNode {
  if (browser === "chrome") return <>ב־<bdi dir="ltr">Chrome</bdi> באייפון זה נעשה בשלושה צעדים.</>;
  if (browser === "firefox") return <>ב־<bdi dir="ltr">Firefox</bdi> באייפון זה נעשה בשלושה צעדים.</>;
  if (browser === "other") return "באייפון זה נעשה מכפתור השיתוף של הדפדפן, בשלושה צעדים.";
  return "באייפון זה נעשה מספארי, בשלושה צעדים.";
}
