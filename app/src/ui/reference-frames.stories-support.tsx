import type { ReactNode } from "react";
import { Button } from "./button";
import { ProgressBar } from "./progress-bar";
import { Banner } from "./banner";
import { TextLink } from "./text-link";
import { BigNumber } from "./big-number";
import { TopBand } from "./top-band";
import { BandHero } from "./layout";
import { CheckIcon, OfflineIcon } from "./icons";
import { Wordmark } from "./wordmark";

function Frame({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="ui-page">
        <h1 className="t-title-1">{title}</h1>
      </header>
      {children}
      {action ? <div className="ui-page-pad mt-auto">{action}</div> : null}
    </div>
  );
}

/** 17a. Android install. The prompt is not wired to beforeinstallprompt yet. */
export function InstallAndroidFrame() {
  return (
    <Frame
      title="להתקין את Flow"
      action={
        <div className="ui-stack">
          <Button>התקנה</Button>
          <Button variant="ghost">לא עכשיו</Button>
        </div>
      }
    >
      <p className="ui-page-pad t-label">האפליקציה נשארת על המסך, בלי חנות.</p>
    </Frame>
  );
}

/** 17b. iPhone install is three Safari steps. */
export function InstallIphoneFrame() {
  const steps = [
    "מקישים על ״שיתוף״ בסרגל של ספארי",
    "בוחרים ״הוספה למסך הבית״",
    "מאשרים ״הוסף״",
  ];
  return (
    <Frame title="הוספה למסך הבית" action={<Button variant="secondary">הבנתי</Button>}>
      <p className="ui-page-pad t-label">באייפון זה נעשה מספארי, בשלושה צעדים.</p>
      <ol className="ui-page-pad ui-stack">
        {steps.map((step, index) => (
          <li key={step} className="ui-page-title-row">
            <span className="ui-step-no t-hint"><bdi dir="ltr">{String(index + 1)}</bdi></span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

/** ld-05. Bank file processing. */
export function UploadProcessingFrame() {
  return (
    <Frame title="קוראים את הקובץ" action={<Button variant="secondary">המשך ברקע</Button>}>
      <p className="ui-page-pad t-label"><bdi dir="ltr">פועלים_ספטמבר.xlsx</bdi></p>
      <div className="ui-page-pad">
        <p className="ui-page-title-row t-label">
          <span>שלב <bdi dir="ltr">2</bdi> מתוך <bdi dir="ltr">3</bdi></span>
          <bdi dir="ltr">60%</bdi>
        </p>
        <ProgressBar label="קריאת הקובץ" value={60} />
      </div>
      <ul className="ui-page-pad ui-stack">
        <li><CheckIcon size={18} /> <bdi dir="ltr">42</bdi> שורות נקלטו</li>
        <li>מתאימים לחשבוניות ולפרויקטים</li>
        <li className="t-hint">מזהים העברות בין החשבונות שלך</li>
      </ul>
    </Frame>
  );
}

/** ld-06. Invoice photo reading. */
export function InvoiceReadingFrame() {
  return (
    <Frame title="קוראים את החשבונית" action={<Button variant="ghost">ביטול</Button>}>
      <p className="ui-page-pad t-label">ספק, סכום, מע״מ ותאריך – עוד כמה שניות</p>
      <div className="ui-page-pad">
        <p className="t-label">שלב <bdi dir="ltr">1</bdi> מתוך <bdi dir="ltr">2</bdi></p>
        <ProgressBar label="קריאת החשבונית" value={40} />
      </div>
    </Frame>
  );
}

/** ld-07. Pull to refresh keeps the content and shows a spinner. */
export function PullToRefreshFrame() {
  return (
    <div>
      <div className="ui-page-pad" style={{ display: "grid", placeItems: "center", minHeight: "var(--touch-min)" }}>
        <span className="ui-spinner" aria-label="מרענן" />
      </div>
      <TopBand>
        <BandHero>
          <p className="t-label">שלום</p>
          <p className="t-display"><BigNumber agorot={3_770_000n} /></p>
        </BandHero>
      </TopBand>
      <p className="ui-page-pad t-hint">הרשימה נשארת במקום בזמן הרענון.</p>
    </div>
  );
}

/** ld-09. Offline with cached books. */
export function OfflineCachedFrame() {
  return (
    <div>
      <TopBand>
        <BandHero>
          <Wordmark tone="on-band" />
          <p className="t-display"><BigNumber agorot={3_770_000n} /></p>
        </BandHero>
      </TopBand>
      <Banner
        icon={<OfflineIcon />}
        title={<>אין חיבור · נתונים מ-<bdi dir="ltr">09:12</bdi></>}
        action={<TextLink onClick={() => undefined}>ניסיון חוזר</TextLink>}
      />
    </div>
  );
}

/** 13. Lock-screen reference. Not an in-app tab. */
export function NotificationsLockFrame() {
  return (
    <div className="ui-page-pad ui-stack">
      <p className="t-label">יום שלישי, 29 בספטמבר</p>
      <p className="t-display"><bdi dir="ltr">18:00</bdi></p>
      <article className="ui-notice">
        <div>
          <p className="t-title-3">סיכום שבועי</p>
          <p className="t-hint">יום א׳ <bdi dir="ltr">08:00</bdi></p>
          <p>רווח <bdi dir="ltr">₪42,000</bdi>. וילה רעננה חרגה ב-<bdi dir="ltr">15%</bdi> מהתקציב</p>
          <p className="t-hint">פתיחה מגיעה הביתה.</p>
        </div>
      </article>
      <article className="ui-notice">
        <div>
          <p className="t-title-3">פריטים ממתינים</p>
          <p className="t-hint"><bdi dir="ltr">18:00</bdi></p>
          <p><bdi dir="ltr">7</bdi> פריטים מחכים לאישור. בערך <bdi dir="ltr">4</bdi> דקות.</p>
          <p className="t-hint">פתיחה מגיעה לתור, ורק אם הוא לא ריק.</p>
        </div>
      </article>
    </div>
  );
}
