/** The browser event behind Android "התקנה". Absent means the manual steps. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let saved: InstallPromptEvent | null = null;
let listening = false;

export function listenForInstallPrompt(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    saved = event as InstallPromptEvent;
  });
}

export function hasInstallPrompt(): boolean {
  return saved != null;
}

/** Calls the saved prompt. A missing event does nothing, so the button is not shown then. */
export async function runInstallPrompt(): Promise<boolean> {
  const event = saved;
  if (!event) return false;
  saved = null;
  await event.prompt();
  return true;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

export type InstallMode = "android-prompt" | "android-steps" | "iphone" | "iphone-other" | "ipad";

/** Picks the install instructions for this browser. A saved prompt is the one-tap Android path. */
export function detectInstallMode(): InstallMode {
  if (typeof navigator === "undefined") return "android-steps";
  const ua = navigator.userAgent;
  const ipad = /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ipad) return "ipad";
  if (/iPhone/.test(ua)) {
    const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    return safari ? "iphone" : "iphone-other";
  }
  return hasInstallPrompt() ? "android-prompt" : "android-steps";
}
