import { Button } from "./button";
import { IconButton } from "./icon-button";
import { Skeleton } from "./skeleton";
import {
  AppIcon,
  CheckIcon,
  CloseIcon,
} from "./icons";

const exampleLabel = "נתוני דוגמה · Example data";

function ReferenceTop() {
  return (
    <div className="ui-ref-top">
      <IconButton label="סגירה" onClick={() => undefined}>
        <CloseIcon />
      </IconButton>
      <span className="t-hint">{exampleLabel}</span>
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
      <div className="ui-lock-cards">
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
      </div>
      <p className="ui-lock-example t-hint">{exampleLabel}</p>
      <div className="ui-lock-home" aria-hidden="true" />
    </div>
  );
}
