import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Skeleton } from "./skeleton";
import {
  AppIcon,
  CheckIcon,
  CloseIcon,
  DocumentIcon,
  InfoIcon,
} from "./icons";

const exampleLabel = "נתוני דוגמה · Example data";

function ReferenceTop() {
  return (
    <div className="ui-ref-top">
      <span className="t-hint">{exampleLabel}</span>
      <IconButton label="סגירה" onClick={() => undefined}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}

function StepMark({ state }: { state: "done" | "busy" | "wait" }) {
  if (state === "done") {
    return (
      <span className="ui-step-mark">
        <CheckIcon size={18} />
      </span>
    );
  }
  if (state === "busy") {
    return (
      <span className="ui-step-mark">
        <span className="ui-spinner" aria-label="בתהליך" />
      </span>
    );
  }
  return <span className="ui-step-mark"><span className="ui-step-wait" /></span>;
}

/** ld-05. Bank file processing. */
export function UploadProcessingFrame() {
  return (
    <div className="ui-ref">
      <ReferenceTop />
      <header className="ui-ref-copy">
        <h1 className="t-title-1">קוראים את הקובץ</h1>
        <p className="t-label"><bdi dir="ltr">פועלים_ספטמבר.xlsx</bdi></p>
      </header>
      <div className="ui-ref-icon">
        <div className="ui-doc-tile" aria-hidden="true">
          <DocumentIcon size={36} />
        </div>
      </div>
      <div className="ui-ref-body">
        <p className="ui-page-title-row t-label">
          <span>שלב <bdi className="ui-num" dir="ltr">2</bdi> מתוך <bdi className="ui-num" dir="ltr">3</bdi></span>
          <bdi className="ui-num" dir="ltr">60%</bdi>
        </p>
        <div className="ui-bar" role="meter" aria-label="קריאת הקובץ" aria-valuenow={60} aria-valuemin={0} aria-valuemax={100}>
          <div className="ui-bar-fill" style={{ width: "60%" }} />
        </div>
        <div className="ui-step-line">
          <StepMark state="done" />
          <span><bdi className="ui-num" dir="ltr">42</bdi> שורות נקלטו</span>
        </div>
        <div className="ui-step-line">
          <StepMark state="busy" />
          <span>מתאימים לחשבוניות ולפרויקטים</span>
        </div>
        <div className="ui-step-line">
          <StepMark state="wait" />
          <span className="t-hint">מזהים העברות בין החשבונות שלך</span>
        </div>
        <div className="ui-note-row">
          <InfoIcon />
          <p>זה לוקח בערך חצי דקה. אפשר לצאת – נודיע כשזה מוכן.</p>
        </div>
      </div>
      <div className="ui-ref-cta">
        <Button variant="secondary" full onClick={() => undefined}>המשך ברקע</Button>
      </div>
    </div>
  );
}

/** ld-06. Invoice photo reading. */
export function InvoiceReadingFrame() {
  return (
    <div className="ui-ref">
      <ReferenceTop />
      <header className="ui-ref-copy">
        <h1 className="t-title-1">קוראים את החשבונית</h1>
        <p className="t-label">ספק, סכום, מע״מ ותאריך – עוד כמה שניות</p>
      </header>
      <div className="ui-ref-icon">
        <div className="ui-invoice-sheet" aria-hidden="true">
          <Skeleton width="sm" />
          <Skeleton width="sm" />
          <Skeleton width="md" />
          <Skeleton width="sm" />
        </div>
      </div>
      <div className="ui-ref-body">
        <div className="ui-field-line">
          <span className="t-label">ספק</span>
          <span>חומרי בניין השרון בע״מ <CheckIcon size={16} /></span>
        </div>
        <div className="ui-field-line">
          <span className="t-label">סכום</span>
          <Skeleton width="sm" />
        </div>
        <div className="ui-field-line">
          <span className="t-label">מע״מ</span>
          <Skeleton width="sm" />
        </div>
        <div className="ui-field-line">
          <span className="t-label">תאריך</span>
          <Skeleton width="sm" />
        </div>
        <p className="ui-match-row">
          <span className="ui-spinner" aria-hidden="true" />
          <span className="t-label">מתאימים לפרויקט ולקטגוריה</span>
        </p>
      </div>
      <div className="ui-ref-cta">
        <Button variant="ghost" full quiet onClick={() => undefined}>ביטול</Button>
      </div>
    </div>
  );
}

/** 13. Lock-screen reference. Not an in-app tab. */
export function NotificationsLockFrame() {
  return (
    <div className="ui-lock">
      <div className="ui-lock-clock">
        <p className="t-label">יום שלישי, 29 בספטמבר</p>
        <p className="ui-lock-time ui-num"><bdi dir="ltr">18:00</bdi></p>
      </div>
      <article className="ui-lock-card">
        <AppIcon size="note" />
        <div className="ui-lock-copy">
          <div className="ui-lock-meta">
            <span><bdi dir="ltr">Flow</bdi></span>
            <span className="t-hint">עכשיו</span>
          </div>
          <p><bdi className="ui-num" dir="ltr">7</bdi> תנועות מחכות לך</p>
          <p className="t-hint">בערך 2 דקות</p>
        </div>
      </article>
      <article className="ui-lock-card">
        <AppIcon size="note" />
        <div className="ui-lock-copy">
          <div className="ui-lock-meta">
            <span><bdi dir="ltr">Flow</bdi></span>
            <span className="t-hint">יום א׳ <bdi dir="ltr">08:00</bdi></span>
          </div>
          <p>סיכום שבועי</p>
          <p className="t-hint">רווח <bdi className="ui-num" dir="ltr">₪42,000</bdi>. וילה רעננה חרגה ב-<bdi className="ui-num" dir="ltr">15%</bdi> מהתקציב</p>
        </div>
      </article>
      <p className="ui-lock-example t-hint">{exampleLabel}</p>
    </div>
  );
}
