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
