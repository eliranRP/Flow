import { useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { homeGreeting, profitBandLabel } from "../home-label";
import { Banner, Notice } from "./banner";
import { BigNumber } from "./big-number";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { GoogleButton } from "./google-button";
import { ChartIcon, DocumentIcon } from "./icons";
import { List, ListRow } from "./list-row";
import { PageTitle, ScreenHeader } from "./screen-header";
import { PeriodPicker } from "./period-picker";
import { SegmentedControl } from "./segmented-control";
import { HomeSkeleton } from "./skeleton";
import { largeAgorot, longHebrew } from "./story-support";
import { TabBar } from "./tab-bar";
import { TextLink } from "./text-link";
import { Toggle } from "./toggle";
import { TopBand } from "./top-band";
import { Wordmark } from "./wordmark";

function Shell({ children, reviewCount = 0 }: { children: ReactNode; reviewCount?: number }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="below-tabbar flex flex-1 flex-col">{children}</div>
      <TabBar reviewCount={reviewCount} />
    </div>
  );
}

function HomeEmpty() {
  return (
    <Shell>
      <TopBand>
        <div className="band-hero">
          <p className="t-title-2">{homeGreeting(null)}</p>
          <h1 className="band-label t-label">{profitBandLabel(false)}</h1>
        </div>
      </TopBand>
      <EmptyState
        icon={<ChartIcon />}
        title="עוד אין נתונים"
        body="הרווח יופיע כאן אחרי ש-SUMIT מחובר."
        action={
          <Button variant="secondary" to="/settings">
            חיבור SUMIT
          </Button>
        }
      />
    </Shell>
  );
}

function HomeBooks({ huge = false }: { huge?: boolean }) {
  const [open, setOpen] = useState(false);
  const [pill, setPill] = useState("כל התקופה");
  const [basis, setBasis] = useState<"cash" | "invoiced">("cash");
  const [overhead, setOverhead] = useState(false);
  const net = huge ? -largeAgorot : basis === "cash" ? -7_630_000n : 3_770_000n;
  const project = huge ? largeAgorot : -2_940_000n;
  return (
    <Shell reviewCount={3}>
      <TopBand
        trailing={
          <PeriodPicker
            pill={pill}
            open={open}
            onOpenChange={setOpen}
            options={[
              { label: "החודש", onSelect: () => { setPill("החודש"); setOpen(false); } },
              { label: "חודש קודם", onSelect: () => { setPill("חודש קודם"); setOpen(false); } },
              { label: "מתחילת השנה", onSelect: () => { setPill("מתחילת השנה"); setOpen(false); } },
              { label: "כל התקופה", onSelect: () => { setPill("כל התקופה"); setOpen(false); } },
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
          <p className="t-title-2">{homeGreeting("אלירן")}</p>
          <p className="band-label t-label">{basis === "cash" ? "רווח נקי במזומן" : "רווח נקי לפי חשבוניות"} · Flow Test</p>
          <h1 className="t-hero">
            <BigNumber agorot={net} />
          </h1>
        </div>
      </TopBand>
      <Banner title="3 פריטים ממתינים לאישור" to="/review" count={3} />
      <div className="section-head">
        <h2 className="t-title-3">פרויקטים</h2>
        <Toggle label="רווח אחרי חלק מהתקורה" checked={overhead} onChange={setOverhead} />
      </div>
      <List>
        <ListRow variant="project" title={huge ? longHebrew : "טק-ליין"} hint="שיפוץ" agorot={project} loss={project < 0n} href="/projects/tek" />
        <ListRow variant="project" title="הוצאות כלליות · תקורה" agorot={huge ? -largeAgorot : -1_200_000n} loss />
      </List>
    </Shell>
  );
}

function SignIn({ failed }: { failed: boolean }) {
  return (
    <main className="signin">
      <div className="signin-brand">
        <Wordmark size="signin" />
        <p className="signin-tagline">הרווח וההפסד של העסק, בלי אקסלים</p>
      </div>
      <section className="signin-sheet">
        {failed ? (
          <Notice
            tone="bad"
            title="לא הצלחנו להתחבר"
            body="אולי אין חיבור לאינטרנט, או ש-Google לא אישרה את החשבון. כדאי לבדוק את החיבור ולנסות שוב."
          />
        ) : null}
        <h1 className="t-title-2 signin-heading">כניסה או הרשמה</h1>
        <p className="t-label text-text-secondary">בלי סיסמה – עם חשבון Google שכבר יש לך</p>
        <div className="signin-button">
          <GoogleButton pending={false} disabled={false} onClick={() => undefined} />
        </div>
        {failed ? (
          <p className="signin-help">
            <TextLink to="/help" className="t-label text-text-secondary underline">
              צריך עזרה בכניסה?
            </TextLink>
          </p>
        ) : null}
        <p className="signin-privacy t-hint">
          נקבל מ-Google רק שם ואימייל. אין לנו גישה לתיבת הדואר.
          <br />
          <TextLink to="/terms" className="underline">
            תנאי שימוש
          </TextLink>
          {" · "}
          <TextLink to="/privacy" className="underline">
            מדיניות פרטיות
          </TextLink>
        </p>
      </section>
    </main>
  );
}

const meta = {
  title: "Screens/Composed",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const HomeEmptyState: Story = { render: () => <HomeEmpty /> };
export const HomeLoading: Story = {
  render: () => (
    <Shell>
      <HomeSkeleton />
    </Shell>
  ),
};
export const HomeOffline: Story = {
  render: () => (
    <Shell>
      <ErrorState offline onRetry={() => undefined} />
    </Shell>
  ),
};
export const HomeServerError: Story = {
  render: () => (
    <Shell>
      <ErrorState offline={false} onRetry={() => undefined} />
    </Shell>
  ),
};
export const HomeBooksCash: Story = { render: () => <HomeBooks /> };
export const HomeLargeAmounts: Story = { render: () => <HomeBooks huge /> };
export const SignInDefault: Story = { render: () => <SignIn failed={false} /> };
export const SignInFailed: Story = { render: () => <SignIn failed /> };
export const Help: Story = {
  render: () => (
    <main className="safe-bottom min-h-dvh">
      <ScreenHeader title="עזרה" subtitle="לעזרה בכניסה כותבים לנו." />
      <p className="mt-4">
        <TextLink className="help-mail t-label text-accent-text underline" href="mailto:ops@nromomentum.com">
          ops@nromomentum.com
        </TextLink>
      </p>
      <TextLink to="/sign-in" className="help-back t-label">
        חזרה
      </TextLink>
    </main>
  ),
};
export const ProjectsEmpty: Story = {
  render: () => (
    <Shell>
      <PageTitle title="פרויקטים" />
      <EmptyState icon={<DocumentIcon />} title="אין עדיין פרויקטים" body="פרויקט נוצר מסעיף תקציב ב-SUMIT, או מכאן." />
    </Shell>
  ),
};
export const ProjectsList: Story = {
  render: () => (
    <Shell>
      <PageTitle title="פרויקטים" />
      <List>
        <ListRow variant="project" title="טק-ליין" hint="שיפוץ" agorot={-2_940_000n} loss href="/projects/tek" />
        <ListRow variant="project" title={longHebrew} agorot={largeAgorot} href="/projects/long" />
      </List>
    </Shell>
  ),
};
export const ReviewEmpty: Story = {
  render: () => (
    <Shell>
      <PageTitle title="לאישור" />
      <EmptyState
        icon={<DocumentIcon />}
        title="אין פריטים לאישור"
        body="כשחסר פרויקט או קטגוריה, הפריט מופיע כאן. הרווח כבר כולל את מה שירד מ-SUMIT."
      />
    </Shell>
  ),
};
export const ReviewQueue: Story = {
  render: () => (
    <Shell reviewCount={2}>
      <PageTitle title="לאישור" />
      <List>
        <ListRow variant="review" title="ספק חדש" hint="חסר פרויקט" agorot={-320_000n} status="ממתין" href="/review" />
        <ListRow variant="review" title={longHebrew} agorot={-largeAgorot} status="ממתין" href="/review" />
      </List>
    </Shell>
  ),
};
