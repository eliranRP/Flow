import { useState } from "react";
import { Avatar } from "./avatar";
import { Banner, Notice } from "./banner";
import { BigNumber } from "./big-number";
import { BudgetBar, ProgressBar } from "./progress-bar";
import { Button } from "./button";
import { Card, Section } from "./card";
import { Chip, StatusPill } from "./chip";
import { ConfirmSheet } from "./confirm-sheet";
import { DatePicker } from "./date-picker";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { GoogleButton } from "./google-button";
import { IconButton } from "./icon-button";
import { ChartIcon, CloseIcon, TrashIcon } from "./icons";
import { ListRow } from "./list-row";
import { Loader, Skeleton } from "./skeleton";
import { MoneyField } from "./money-field";
import { PeriodPicker } from "./period-picker";
import { ScreenHeader } from "./screen-header";
import { SegmentedControl } from "./segmented-control";
import { SelectField } from "./select-field";
import { SheetSurface } from "./sheet";
import { TabBar } from "./tab-bar";
import { TextField } from "./text-field";
import { Toggle } from "./toggle";
import { TopBand } from "./top-band";

function setTheme(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
}

/** Review route. It is not in the tab bar. */
export function ComponentsGallery() {
  const [basis, setBasis] = useState<"cash" | "invoiced">("cash");
  const [overhead, setOverhead] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [date, setDate] = useState<string | null>("2026-09-21");

  return (
    <main className="ui-gallery safe-bottom">
      <ScreenHeader title="ספריית הרכיבים" subtitle="בדיקה מול מערכת העיצוב. לא מופיע בניווט." />
      <div className="ui-gallery-block">
        <Button
          variant="secondary"
          onClick={() => {
            setTheme("light");
          }}
        >
          בהיר
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setTheme("dark");
          }}
        >
          כהה
        </Button>
      </div>

      <section className="ui-gallery-block" aria-label="כפתורים">
        <h2 className="t-title-3">כפתורים</h2>
        <Button variant="primary">אישור</Button>
        <Button variant="secondary">שינוי</Button>
        <Button variant="pill">סימון כשולם</Button>
        <Button variant="danger">
          <TrashIcon />
          מחיקה
        </Button>
        <Button variant="ghost">ביטול</Button>
        <Button variant="primary" busy>
          מאשר…
        </Button>
        <IconButton label="סגירה">
          <CloseIcon />
        </IconButton>
        <GoogleButton pending={false} disabled={false} onClick={() => undefined} />
      </section>

      <TopBand
        trailing={
          <PeriodPicker
            pill="החודש"
            open={periodOpen}
            onOpenChange={setPeriodOpen}
            options={[
              { label: "החודש", onSelect: () => undefined },
              { label: "חודש קודם", onSelect: () => undefined },
              { label: "מתחילת השנה", onSelect: () => undefined },
              { label: "כל התקופה", onSelect: () => undefined },
            ]}
            footer={
              <SegmentedControl
                label="בסיס"
                value={basis}
                onChange={setBasis}
                options={[
                  { value: "cash", label: "מזומן" },
                  { value: "invoiced", label: "חשבוניות" },
                ]}
              />
            }
          />
        }
      >
        <div className="band-hero">
          <p className="t-title-2">שלום, אלירן</p>
          <p className="band-label t-label">רווח נקי במזומן</p>
          <h2 className="t-hero">
            <BigNumber agorot={-7630000n} size="hero" />
          </h2>
        </div>
      </TopBand>

      <section className="ui-gallery-block" aria-label="סכומים">
        <h2 className="t-title-3">סכומים לפני מע״מ</h2>
        <BigNumber agorot={47200000n} size="display" />
        <BigNumber agorot={-1000000n} size="list" loss />
        <BigNumber agorot={10050n} presentation="detail" />
      </section>

      <section className="ui-gallery-block" aria-label="שורות">
        <h2 className="t-title-3">שורות</h2>
        <ListRow variant="project" title="שיפוץ הרצל 12" hint="רווחיות 27%" agorot={20000000n} />
        <ListRow variant="project" title="טק-ליין" hint="−17%" agorot={-2940000n} loss />
        <ListRow variant="transaction" title="כוח אדם מקצועי" hint="עבודה · 22/09" agorot={1200000n} sign="out" source="bank" />
        <ListRow variant="transaction" title="לקוח הרצל" hint="תקבול · 22/09" agorot={15000000n} sign="in" source="invoice" />
        <ListRow variant="review" title="חשבונית ללא פרויקט" hint="ממתין" agorot={450000n} status="ממתין" />
        <ListRow variant="supplier" title="ביטוח המגן בע״מ" hint="ספק" vatExempt />
      </section>

      <Card>
        <p className="t-label">כרטיס</p>
      </Card>
      <Section title="מקטע">
        <p className="t-hint">מקטע עם כותרת</p>
      </Section>

      <Banner title="7 פריטים ממתינים לאישור" hint="3 חשבוניות לא שולמו" count={7} />
      <Notice title="הכניסה לא הושלמה" body="החלון של Google נסגר. אפשר לנסות שוב." />
      <Notice tone="bad" title="לא הצלחנו להתחבר" body="כדאי לבדוק את החיבור ולנסות שוב." />

      <section className="ui-gallery-block" aria-label="שדות">
        <TextField label="שם העסק" placeholder="למשל: א.ר. בנייה" />
        <TextField label="ח.פ." error="מספר קצר מדי – 9 ספרות" defaultValue="123" />
        <MoneyField label="סכום" defaultValue="1,200" />
        <SelectField
          label="קטגוריה"
          options={[
            { value: "materials", label: "חומרים" },
            { value: "labor", label: "עבודה" },
          ]}
        />
        <Toggle
          label="רווח אחרי חלק מהתקורה"
          hint={overhead ? "פועל" : "כבוי · מציג רווח לפני כלליות"}
          checked={overhead}
          onChange={setOverhead}
        />
        <DatePicker label="תאריך ההוצאה" value={date} onChange={setDate} />
        <SegmentedControl
          label="תצוגה"
          value={basis}
          onChange={setBasis}
          options={[
            { value: "cash", label: "מזומן" },
            { value: "invoiced", label: "חשבוניות" },
          ]}
        />
      </section>

      <section className="ui-gallery-block" aria-label="שבבים">
        <Chip kind="suggested">אחרון</Chip>
        <Chip kind="choice">חומרים</Chip>
        <Chip kind="choice" pressed>
          עבודה
        </Chip>
        <Chip kind="disabled">מוסתר</Chip>
        <StatusPill>שולם</StatusPill>
        <Avatar name="אלירן" />
        <ProgressBar value={40} label="התקדמות" />
        <BudgetBar label="תקציב" spentAgorot={8000000n} budgetAgorot={10000000n} />
        <BudgetBar label="חריגה" spentAgorot={12000000n} budgetAgorot={10000000n} />
      </section>

      <SheetSurface title="למחוק את ההוצאה?">
        <p className="t-label">כוח אדם מקצועי · −₪12,000</p>
        <p className="t-hint">אפשר לבטל 4 שניות אחרי האישור.</p>
        <Button variant="danger" full>
          <TrashIcon />
          מחיקה
        </Button>
        <Button variant="ghost" full>
          ביטול
        </Button>
      </SheetSurface>
      <Button
        variant="secondary"
        onClick={() => {
          setConfirmOpen(true);
        }}
      >
        פתיחת אישור מחיקה
      </Button>
      <ConfirmSheet
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="למחוק את ההוצאה?"
        item="כוח אדם מקצועי"
        consequence="אפשר לבטל 4 שניות אחרי האישור."
        confirmLabel="מחיקה"
        destructive
        onConfirm={() => {
          setConfirmOpen(false);
        }}
      />

      <EmptyState icon={<ChartIcon />} title="עוד אין נתונים" body="הרווח יופיע כאן אחרי ש-SUMIT מחובר." />
      <Loader />
      <Skeleton className="home-skel-name" />
      <ErrorState
        offline={false}
        onRetry={() => {
          setTheme("light");
        }}
      />

      <div className="ui-gallery-block" aria-label="סרגל לשוניות">
        <TabBar label="סרגל לשוניות, דוגמה" reviewCount={7} />
      </div>
    </main>
  );
}
