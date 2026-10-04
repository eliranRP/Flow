import { type CSSProperties, type ReactNode } from "react";
import { Button } from "./button";
import { CheckRow } from "./check-row";
import { Chip } from "./chip";
import { DemoPlayer, useDemoPlayback } from "./demo-player";
import { AppIcon, CheckIcon, ChevronIcon, ShareIcon, SparkIcon, SquarePlusIcon } from "./icons";
import { ListRow } from "./list-row";
import { ReviewCard, type ReviewSuggestion } from "./review-card";
import { Skeleton } from "./skeleton";
import { TabBar } from "./tab-bar";
import { TextField } from "./text-field";
import { Toggle } from "./toggle";
import "./setup-demos.css";

/** Storyboard lengths. Each one is inside 3.0–4.6s. */
export const SUMIT_DEMO_MS = 4000;
export const JEV_DEMO_MS = 3600;
export const PROJECTS_DEMO_MS = 4000;
export const APPROVAL_DEMO_MS = 4000;
export const IOS_DEMO_MS = 4600;
export const ANDROID_DEMO_MS = 3000;

export const SUMIT_ALT = "הדגמה: מחברים את SUMIT, והתנועות נכנסות ללשונית לאישור.";
export const JEV_ALT = "הדגמה: לתנועה נוספת הצעה של פרויקט וקטגוריה, מסומנת הצעה.";
export const PROJECTS_ALT = "הדגמה: רשימת הפרויקטים מ־SUMIT מסומנת, וקטגוריה אחת עוברת למוסתרות.";
export const APPROVAL_ALT = "הדגמה: הקשה על אישור, הכרטיס יוצא והמונה יורד באחד.";
export const IOS_ALT = "הדגמה: בספארי מקישים על שלוש הנקודות, ואז שיתוף והוספה למסך הבית.";
export const ANDROID_ALT = "הדגמה: הקשה על התקנה, והסמל של Flow מופיע במסך הבית.";

/** The drawings use a stand-in host. The build shows the page host. */
export function demoHost(): string {
  return window.location.host;
}

/** 0 before `start`, 1 after `end`, linear between. */
export function demoBeat(progress: number, start: number, end: number): number {
  if (progress <= start) return 0;
  if (progress >= end || end <= start) return 1;
  return (progress - start) / (end - start);
}

/** cubic-bezier(0.4, 0, 1, 1), the ease-exit token. */
export function easeExit(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x1 = 0.4;
  const x2 = 1;
  let u = t;
  for (let i = 0; i < 6; i += 1) {
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const x = ((ax * u + bx) * u + cx) * u;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(dx) < 1e-6) break;
    u = Math.min(1, Math.max(0, u - (x - t) / dx));
  }
  const y1 = 0;
  const y2 = 1;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return ((ay * u + by) * u + cy) * u;
}

/** 1-based frame. `edges` are the progress values where the next frame starts. */
export function demoFrame(progress: number, edges: readonly number[]): number {
  let frame = 1;
  for (const edge of edges) {
    if (progress >= edge) frame += 1;
  }
  return frame;
}

function hold(progress: number, start: number, end: number): number {
  const inn = start <= 0 ? 1 : demoBeat(progress, start, Math.min(end, start + 0.05));
  const out = end >= 1 ? 1 : 1 - demoBeat(progress, end, Math.min(1, end + 0.05));
  return Math.min(inn, out);
}

function styleOf(values: Record<string, number>): CSSProperties {
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) style[key] = String(value);
  return style;
}

function at(ms: number, duration: number): number {
  return ms / duration;
}

/** Fingertip dot. The amount is 0 when the finger is gone. */
function TapDot({ amount }: { amount: number }) {
  return <span className="ui-setup-ring" style={styleOf({ "--setup-ring": amount })} />;
}

function HostLine() {
  return (
    <span className="ui-setup-host">
      <bdi dir="ltr">{demoHost()}</bdi>
    </span>
  );
}

function PlugIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M8 7v4M16 7v4" />
      <path d="M7 11h10v3a5 5 0 0 1-10 0z" />
      <path d="M12 19v3" />
    </svg>
  );
}

const suggested: ReviewSuggestion = {
  project: "פרויקט לדוגמה",
  category: "קטגוריה לדוגמה",
  projectSuggested: true,
  categorySuggested: true,
};

export function SumitConnectDemo() {
  return (
    <DemoPlayer alt={SUMIT_ALT} durationMs={SUMIT_DEMO_MS}>
      <SumitScene />
    </DemoPlayer>
  );
}

function SumitScene() {
  const { progress } = useDemoPlayback();
  const frame = demoFrame(progress, [0.2, 0.4, 0.7]);
  const fill = demoBeat(progress, 0.04, 0.18);
  const press = demoBeat(progress, 0.2, 0.25);
  const sheetOut = easeExit(demoBeat(progress, 0.4, 0.46));
  const hello = demoBeat(progress, 0.48, 0.58);
  const line1 = demoBeat(progress, 0.58, 0.64);
  const line2 = demoBeat(progress, 0.64, 0.7);
  const line3 = demoBeat(progress, 0.7, 0.76);
  const company = "1001".slice(0, Math.round(fill * 4));
  const secret = "demo".slice(0, Math.round(fill * 4));
  const scrim = sheetOut < 1 ? 1 - sheetOut : 0;
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-scrim" style={styleOf({ "--setup-opacity": scrim })} />
      <div className="ui-setup-result" data-setup-visible={hello >= 1 ? "true" : "false"}>
        <div className="ui-setup-sumit-row ui-setup-drop" style={styleOf({ "--setup-drop": hello })}>
          <PlugIcon />
          <span>
            <bdi dir="ltr">SUMIT</bdi>
            {" מחובר"}
          </span>
          <CheckIcon />
        </div>
        <SumitLine title="ספק לדוגמה בע״מ" hint="הוצאה · 01/09" agorot={850_000n} sign="out" drop={line1} />
        <SumitLine title="לקוח לדוגמה" hint="הכנסה · 02/09" agorot={120_000n} sign="in" drop={line2} />
        <SumitLine title="ספק שלישי לדוגמה" hint="הוצאה · 03/09" agorot={64_000n} sign="out" drop={line3} />
        <TabBar reviewCount={demoBeat(progress, 0.7, 0.82) >= 1 ? 12 : 0} />
      </div>
      <div
        className="ui-setup-sheet ui-setup-dock"
        data-setup-visible={sheetOut < 1 ? "true" : "false"}
        style={styleOf({ "--setup-out": sheetOut, "--setup-opacity": 1 - sheetOut })}
      >
        <span className="ui-setup-handle" />
        <p className="t-title-3">
          חיבור <bdi dir="ltr">SUMIT</bdi>
        </p>
        <TextField label="מספר חברה" value={company} inputMode="numeric" readOnly onChange={() => {}} />
        <TextField label="מפתח API" type="password" value={secret} readOnly autoComplete="off" onChange={() => {}} />
        <div className="ui-setup-hit">
          <Button full busy={progress >= 0.25 && progress < 0.4} className={press >= 1 ? "ui-setup-pressed" : undefined}>
            חיבור
          </Button>
        </div>
      </div>
    </div>
  );
}

function SumitLine({ title, hint, agorot, sign, drop }: { title: string; hint: string; agorot: bigint; sign: "in" | "out"; drop: number }) {
  return (
    <div className="ui-setup-drop" style={styleOf({ "--setup-drop": drop })}>
      <ListRow variant="transaction" title={title} hint={hint} agorot={agorot} sign={sign} source="invoice" />
    </div>
  );
}

export function JevSwitchDemo() {
  return (
    <DemoPlayer alt={JEV_ALT} durationMs={JEV_DEMO_MS}>
      <JevScene />
    </DemoPlayer>
  );
}

function JevScene() {
  const { progress } = useDemoPlayback();
  const frame = demoFrame(progress, [0.25, 0.5, 0.75]);
  const project = demoBeat(progress, 0.5, 0.66);
  const category = demoBeat(progress, 0.75, 0.9);
  const suggestion: ReviewSuggestion = {
    project: project > 0 ? "פרויקט לדוגמה" : undefined,
    category: category > 0 ? "קטגוריה לדוגמה" : undefined,
    projectSuggested: project > 0,
    categorySuggested: category > 0,
  };
  return (
    <div className="ui-setup-demo ui-setup-jev" data-demo-frame={frame}>
      <div className="ui-setup-head">
        <p className="t-title-3">לאישור</p>
      </div>
      <ReviewCard
        supplier="ספק לדוגמה בע״מ"
        sourceLine="חשבונית · 01/09/2026"
        netAgorot={850_000n}
        vatLine="לפני מע״מ"
        suggestion={suggestion}
        onProject={project > 0 ? () => {} : undefined}
        onCategory={category > 0 ? () => {} : undefined}
      />
      <p className="ui-setup-fade t-label" data-setup-visible={project >= 1 || category >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": Math.max(project, category) })}>
        <SparkIcon size={16} /> הצעה
      </p>
    </div>
  );
}

export function ProjectsDemo() {
  return (
    <DemoPlayer alt={PROJECTS_ALT} durationMs={PROJECTS_DEMO_MS}>
      <ProjectsScene />
    </DemoPlayer>
  );
}

function ProjectsScene() {
  const { progress } = useDemoPlayback();
  const frame = demoFrame(progress, [0.22, 0.46, 0.72]);
  const rowA = demoBeat(progress, 0.22, 0.3);
  const rowB = demoBeat(progress, 0.3, 0.38);
  const rowC = demoBeat(progress, 0.38, 0.46);
  const chipA = demoBeat(progress, 0.46, 0.52);
  const chipB = demoBeat(progress, 0.52, 0.58);
  const chipC = demoBeat(progress, 0.58, 0.64);
  const chipD = demoBeat(progress, 0.64, 0.7);
  const chipE = demoBeat(progress, 0.7, 0.76);
  const leave = demoBeat(progress, 0.78, 0.92);
  const skeleton = 1 - Math.max(rowA, rowB, rowC);
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-skel" aria-hidden="true" style={styleOf({ "--setup-fade": skeleton })}>
        <Skeleton width="lg" />
        <Skeleton width="md" />
        <Skeleton width="lg" />
      </div>
      <p className="t-label">פרויקטים</p>
      <ProjectRow label="פרויקט לדוגמה" amount={rowA} />
      <ProjectRow label="פרויקט שני לדוגמה" amount={rowB} />
      <ProjectRow label="פרויקט שלישי לדוגמה" amount={rowC} />
      <p className="t-label">קטגוריות</p>
      <div className="ui-setup-pills">
        <ChoiceChip label="קטגוריה א׳" amount={chipA} />
        <ChoiceChip label="קטגוריה ב׳" amount={chipB} />
        <ChoiceChip label="קטגוריה ג׳" amount={chipC} />
        <ChoiceChip label="קטגוריה ד׳" amount={chipD} />
        {leave < 1 ? <ChoiceChip label="קטגוריה ה׳" amount={chipE} leaving={leave} /> : null}
      </div>
      <p className="ui-setup-fade t-hint" data-setup-visible={leave >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": leave })}>
        מוסתרות · <bdi dir="ltr">1</bdi>
      </p>
    </div>
  );
}

function ProjectRow({ label, amount }: { label: string; amount: number }) {
  if (amount <= 0) return null;
  return (
    <div className="ui-setup-fade" data-setup-visible={amount >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": amount })}>
      <CheckRow label={label} checked={amount >= 1} onChange={() => {}} />
    </div>
  );
}

function ChoiceChip({ label, amount, leaving = 0 }: { label: string; amount: number; leaving?: number }) {
  if (amount <= 0) return null;
  const leavingChip = leaving > 0;
  return (
    <span
      className={leavingChip ? "ui-setup-chip-leave" : "ui-setup-fade"}
      data-setup-visible={amount >= 1 && leaving < 1 ? "true" : "false"}
      style={styleOf(leavingChip ? { "--setup-leave": leaving, "--setup-in": amount } : { "--setup-fade": amount })}
    >
      <Chip kind="choice">{label}</Chip>
    </span>
  );
}

export function FirstApprovalDemo() {
  return (
    <DemoPlayer alt={APPROVAL_ALT} durationMs={APPROVAL_DEMO_MS}>
      <ApprovalScene />
    </DemoPlayer>
  );
}

function ApprovalScene() {
  const { progress } = useDemoPlayback();
  const frame = demoFrame(progress, [0.2, 0.4, 0.65]);
  const ringIn = demoBeat(progress, 0.22, 0.2575);
  const ringFade = demoBeat(progress, 0.2575, 0.32);
  const ring = progress < 0.32 ? ringIn * (1 - ringFade) : 0;
  const press = demoBeat(progress, 0.25, 0.275);
  const leave = easeExit(demoBeat(progress, 0.4, 0.4625));
  const next = demoBeat(progress, 0.5, 0.65);
  const count = leave >= 1 ? "11" : "12";
  return (
    <div className="ui-setup-demo ui-setup-approve" data-demo-frame={frame}>
      <div className="ui-setup-head" data-setup-visible="true">
        <p className="t-title-3">לאישור</p>
        <p className="t-hint">
          <bdi dir="ltr" data-demo-count={count}>{count}</bdi>
          {" נשארו"}
        </p>
      </div>
      <div className="ui-setup-stack">
        <div className="ui-setup-leave" data-setup-visible={leave < 1 ? "true" : "false"} style={styleOf({ "--setup-leave": leave })}>
          <ApprovalCard supplier="ספק לדוגמה בע״מ" agorot={850_000n} pressed={press >= 1} ring={ring} />
        </div>
        <div className="ui-setup-fade" data-setup-visible={next >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": next })}>
          <ApprovalCard supplier="ספק נוסף לדוגמה" agorot={120_000n} />
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({ supplier, agorot, pressed = false, ring = 0 }: { supplier: string; agorot: bigint; pressed?: boolean; ring?: number }) {
  return (
    <div>
      <ReviewCard
        supplier={supplier}
        sourceLine="חשבונית · 01/09/2026"
        netAgorot={agorot}
        vatLine="לפני מע״מ"
        suggestion={suggested}
        onProject={() => {}}
        onCategory={() => {}}
      />
      <div className="ui-setup-hit">
        <TapDot amount={ring} />
        <Button full icon={<CheckIcon />} className={pressed ? "ui-setup-pressed" : undefined}>
          אישור
        </Button>
      </div>
    </div>
  );
}

const IOS_EDGES = [at(900, IOS_DEMO_MS), at(1900, IOS_DEMO_MS), at(3000, IOS_DEMO_MS), at(3800, IOS_DEMO_MS)];

export function IosInstallDemo() {
  return (
    <DemoPlayer alt={IOS_ALT} durationMs={IOS_DEMO_MS}>
      <IosScene />
    </DemoPlayer>
  );
}

function IosScene() {
  const { progress } = useDemoPlayback();
  const frame = demoFrame(progress, IOS_EDGES);
  const bar = hold(progress, 0, IOS_EDGES[0] ?? 1);
  const menu = hold(progress, IOS_EDGES[0] ?? 0, IOS_EDGES[1] ?? 1);
  const share = hold(progress, IOS_EDGES[1] ?? 0, IOS_EDGES[2] ?? 1);
  const add = hold(progress, IOS_EDGES[2] ?? 0, IOS_EDGES[3] ?? 1);
  const home = hold(progress, IOS_EDGES[3] ?? 0, 1);
  const barRing = bar >= 1 ? demoBeat(progress, 0.04, 0.1) : 0;
  const addRing = add >= 0.5 && add < 1 ? demoBeat(progress, IOS_EDGES[2] ?? 0, (IOS_EDGES[2] ?? 0) + 0.04) : 0;
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-safari-bar ui-setup-dock ui-setup-panel" dir="ltr" data-setup-visible={bar >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": bar })}>
        <ChevronIcon size={18} />
        <HostLine />
        <span className="ui-setup-hit">
          <bdi dir="ltr">•••</bdi>
          <TapDot amount={barRing} />
        </span>
      </div>
      <MenuPanel amount={menu} rows={[["העתקת הקישור", false], ["שיתוף", true], ["הוספה למועדפים", false]]} icon={<ShareIcon />} />
      <MenuPanel amount={share} rows={[["העתקה", false], ["הוספה למסך הבית", true], ["הדפסה", false]]} icon={<SquarePlusIcon />} />
      <div className="ui-setup-add ui-setup-panel" data-setup-visible={add >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": add })}>
        <AppIcon size="note" />
        <TextField label="שם" value="Flow" readOnly onChange={() => {}} />
        <Toggle label="פתיחה כאפליקציה" checked={add >= 1} onChange={() => {}} />
        <div className="ui-setup-hit">
          <TapDot amount={addRing} />
          <Button variant="pill">הוספה</Button>
        </div>
      </div>
      <HomeGrid amount={home} />
    </div>
  );
}

function MenuPanel({ amount, rows, icon }: { amount: number; rows: Array<[string, boolean]>; icon: ReactNode }) {
  return (
    <div className="ui-setup-menu ui-setup-panel" data-setup-visible={amount >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": amount })}>
      {rows.map(([label, on]) => (
        <div className="ui-setup-menu-row" data-on={on ? "true" : "false"} key={label}>
          {on ? icon : null}
          {label}
        </div>
      ))}
    </div>
  );
}

export function AndroidInstallDemo() {
  return (
    <DemoPlayer alt={ANDROID_ALT} durationMs={ANDROID_DEMO_MS}>
      <AndroidScene />
    </DemoPlayer>
  );
}

function AndroidScene() {
  const { progress } = useDemoPlayback();
  const page = at(800, ANDROID_DEMO_MS);
  const dialogAt = at(1900, ANDROID_DEMO_MS);
  const frame = demoFrame(progress, [page, dialogAt]);
  const button = hold(progress, 0, page);
  const dialog = hold(progress, page, dialogAt);
  const home = hold(progress, dialogAt, 1);
  const buttonRing = button >= 1 ? demoBeat(progress, 0.04, 0.12) : 0;
  const dialogRing = dialog >= 0.5 && dialog < 1 ? demoBeat(progress, page, page + 0.06) : 0;
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-layer ui-setup-panel" data-setup-visible={button >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": button })}>
        <div className="ui-setup-hit">
          <TapDot amount={buttonRing} />
          <Button full>התקנה</Button>
        </div>
      </div>
      <div className="ui-setup-scrim" style={styleOf({ "--setup-opacity": dialog })} />
      <div className="ui-setup-dialog ui-setup-dock ui-setup-rise" data-setup-visible={dialog >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-rise": dialog })}>
        <p className="t-title-3">להתקין את Flow?</p>
        <HostLine />
        <div className="ui-setup-actions">
          <Button variant="secondary">ביטול</Button>
          <div className="ui-setup-hit">
            <TapDot amount={dialogRing} />
            <Button full>התקנה</Button>
          </div>
        </div>
      </div>
      <HomeGrid amount={home} />
    </div>
  );
}

function HomeGrid({ amount }: { amount: number }) {
  return (
    <div className="ui-setup-home ui-setup-layer ui-setup-panel" data-setup-visible={amount >= 1 ? "true" : "false"} style={styleOf({ "--setup-opacity": amount })}>
      <span className="ui-setup-tile" />
      <span className="ui-setup-icon ui-setup-land" style={styleOf({ "--setup-land": amount })}>
        <AppIcon size="note" />
        <span className="t-hint">Flow</span>
      </span>
      <span className="ui-setup-tile" />
      <span className="ui-setup-tile" />
    </div>
  );
}
