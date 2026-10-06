import { type CSSProperties, type ReactNode } from "react";
import { formatAmount } from "./big-number";
import { Button } from "./button";
import { CheckRow } from "./check-row";
import { Chip } from "./chip";
import { DemoPlayer, useDemoPlayback } from "./demo-player";
import { DemoPointer, easeStandard, POINTER_REACT_MS, type DemoPointerVariant, type PointerTimeline } from "./demo-pointer";
import { AppIcon, CheckIcon, ChevronIcon, ShareIcon, SparkIcon, SquarePlusIcon } from "./icons";
import { ListRow } from "./list-row";
import { Skeleton } from "./skeleton";
import { TextField } from "./text-field";
import { Toggle } from "./toggle";
import "./setup-demos.css";

/** Storyboard lengths. The iPhone demo is 4.75s; the others stay inside 3.0–4.6s. */
export const SUMIT_DEMO_MS = 4120;
export const JEV_DEMO_MS = 3800;
export const PROJECTS_DEMO_MS = 3700;
export const APPROVAL_DEMO_MS = 3350;
export const IOS_DEMO_MS = 4750;
export const ANDROID_DEMO_MS = 3580;

export const SUMIT_POINTER: PointerTimeline = {
  fadeIn: { start: 200, duration: 150 },
  fadeOut: { start: 2650, duration: 200 },
  moves: [
    { start: 350, duration: 600, target: "key" },
    { start: 1300, duration: 500, target: "connect" },
  ],
  taps: [950, 1800],
};

export const JEV_POINTER: PointerTimeline = {
  fadeIn: { start: 200, duration: 150 },
  fadeOut: { start: 2400, duration: 200 },
  moves: [{ start: 350, duration: 600, target: "switch" }],
  taps: [950],
};

export const PROJECTS_POINTER: PointerTimeline = {
  fadeIn: { start: 1300, duration: 150 },
  fadeOut: { start: 2850, duration: 200 },
  moves: [{ start: 1450, duration: 600, target: "chip" }],
  taps: [2050],
};

export const APPROVAL_POINTER: PointerTimeline = {
  fadeIn: { start: 200, duration: 150 },
  fadeOut: { start: 2300, duration: 200 },
  moves: [{ start: 350, duration: 650, target: "approve" }],
  taps: [1000],
};

export const IOS_POINTER: PointerTimeline = {
  fadeIn: { start: 200, duration: 150 },
  fadeOut: { start: 3650, duration: 200 },
  moves: [
    { start: 350, duration: 600, target: "more" },
    { start: 1300, duration: 500, target: "share" },
    { start: 2150, duration: 500, target: "addhome" },
    { start: 3000, duration: 500, target: "add" },
  ],
  taps: [950, 1800, 2650, 3500],
};

export const ANDROID_POINTER: PointerTimeline = {
  fadeIn: { start: 200, duration: 150 },
  fadeOut: { start: 2080, duration: 200 },
  moves: [
    { start: 350, duration: 600, target: "install" },
    { start: 1380, duration: 550, target: "confirm" },
  ],
  taps: [950, 1930],
};

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

/** 1-based frame. `edges` are the times where the next frame starts. */
export function demoFrame(progress: number, edges: readonly number[]): number {
  let frame = 1;
  for (const edge of edges) {
    if (progress >= edge) frame += 1;
  }
  return frame;
}

function styleOf(values: Record<string, number>): CSSProperties {
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) style[key] = String(value);
  return style;
}

function played(elapsed: number, start: number, duration: number): number {
  return easeStandard(demoBeat(elapsed, start, start + duration));
}

function exited(elapsed: number, start: number, duration: number): number {
  return easeExit(demoBeat(elapsed, start, start + duration));
}

function tapAt(timeline: PointerTimeline, index: number): number {
  return timeline.taps[index] ?? 0;
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

const HOME_BEFORE = ["slot-1", "slot-2", "slot-3", "slot-4", "slot-5", "slot-6"] as const;

type SceneProps = { pointer: DemoPointerVariant };

export function SumitConnectDemo({ pointer = "dot" }: { pointer?: DemoPointerVariant }) {
  return (
    <DemoPlayer alt={SUMIT_ALT} durationMs={SUMIT_DEMO_MS}>
      <SumitScene pointer={pointer} />
    </DemoPlayer>
  );
}

function SumitScene({ pointer }: SceneProps) {
  const { progress } = useDemoPlayback();
  const elapsed = progress * SUMIT_DEMO_MS;
  const fieldsAt = tapAt(SUMIT_POINTER, 0) + POINTER_REACT_MS;
  const busyAt = tapAt(SUMIT_POINTER, 1) + POINTER_REACT_MS;
  const sheetAt = SUMIT_POINTER.fadeOut.start;
  const frame = demoFrame(elapsed, [fieldsAt, busyAt, sheetAt]);
  const sheetOut = exited(elapsed, sheetAt, 220);
  const hello = played(elapsed, sheetAt + 220, 200);
  const line1 = played(elapsed, sheetAt + 220, 200);
  const line2 = played(elapsed, sheetAt + 340, 200);
  const line3 = played(elapsed, sheetAt + 460, 200);
  const scrim = sheetOut < 1 ? 1 - sheetOut : 0;
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-scrim" style={styleOf({ "--setup-opacity": scrim })} />
      <div className="ui-setup-result" data-setup-visible={hello >= 1 ? "true" : "false"}>
        <div className="ui-setup-sumit-row ui-setup-drop" style={styleOf({ "--setup-drop": hello })}>
          <span className="ui-setup-lead" aria-hidden="true">
            <PlugIcon />
          </span>
          <span className="ui-setup-sumit-copy">
            <span className="t-title-3">
              <bdi dir="ltr">SUMIT</bdi>
            </span>
            <span className="t-hint">מחובר</span>
          </span>
          <span className="ui-setup-stat">
            <CheckIcon size={16} />
          </span>
        </div>
        <SumitLine title="חומרי בניין הדר" hint="הוצאה · 21/09" agorot={850_000n} sign="out" drop={line1} />
        <SumitLine title="אבי חשמל" hint="הוצאה · 20/09" agorot={234_000n} sign="out" drop={line2} />
        <SumitLine title="וילה רעננה" hint="הכנסה · 19/09" agorot={4_500_000n} sign="in" drop={line3} />
        <div className="ui-setup-tabs ui-setup-drop" style={styleOf({ "--setup-drop": hello })}>
          <span className="ui-setup-tab">בית</span>
          <span className="ui-setup-tab" data-on="true">
            לאישור
            <span className="ui-setup-badge">
              <bdi dir="ltr">12</bdi>
            </span>
          </span>
          <span className="ui-setup-tab">הגדרות</span>
        </div>
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
        <TextField label="מספר חברה" value={elapsed > fieldsAt ? "1001" : ""} inputMode="numeric" readOnly onChange={() => {}} />
        <TextField label="מפתח API" data-tap="key" type="password" value={elapsed > fieldsAt ? "demo" : ""} readOnly autoComplete="off" onChange={() => {}} />
        <div className="ui-setup-hit">
          <Button full busy={elapsed > busyAt && sheetOut <= 0} data-tap="connect">
            חיבור
          </Button>
        </div>
      </div>
      <DemoPointer elapsedMs={elapsed} timeline={SUMIT_POINTER} variant={pointer} />
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

export function JevSwitchDemo({ pointer = "dot" }: { pointer?: DemoPointerVariant }) {
  return (
    <DemoPlayer alt={JEV_ALT} durationMs={JEV_DEMO_MS}>
      <JevScene pointer={pointer} />
    </DemoPlayer>
  );
}

function JevScene({ pointer }: SceneProps) {
  const { progress } = useDemoPlayback();
  const elapsed = progress * JEV_DEMO_MS;
  const switchAt = tapAt(JEV_POINTER, 0) + POINTER_REACT_MS;
  const sparkAt = 1700;
  const pillsAt = JEV_POINTER.fadeOut.start;
  const frame = demoFrame(elapsed, [switchAt, sparkAt, pillsAt]);
  const spark = played(elapsed, sparkAt, 200);
  const project = played(elapsed, pillsAt, 200);
  const category = played(elapsed, pillsAt + 150, 200);
  return (
    <div className="ui-setup-demo ui-setup-jev" data-demo-frame={frame}>
      <div className="ui-setup-switch">
        <Toggle label="תיוג חכם (Jev)" checked={elapsed > switchAt} onChange={() => {}} />
        <span className="ui-setup-switch-hit" data-tap="switch" />
      </div>
      <div className="ui-setup-head">
        <p className="t-title-3">לאישור</p>
      </div>
      <DemoFact
        supplier="חומרי בניין הדר בע״מ"
        date="21/09/2026"
        agorot={850_000n}
        vat="₪1,530"
        spark={spark}
        project={project > 0 ? "וילה רעננה" : undefined}
        projectAmount={project}
        category={category > 0 ? "חומרים" : undefined}
        categoryAmount={category}
      />
      <DemoPointer elapsedMs={elapsed} timeline={JEV_POINTER} variant={pointer} />
    </div>
  );
}

export function ProjectsDemo({ pointer = "dot" }: { pointer?: DemoPointerVariant }) {
  return (
    <DemoPlayer alt={PROJECTS_ALT} durationMs={PROJECTS_DEMO_MS}>
      <ProjectsScene pointer={pointer} />
    </DemoPlayer>
  );
}

function ProjectsScene({ pointer }: SceneProps) {
  const { progress } = useDemoPlayback();
  const elapsed = progress * PROJECTS_DEMO_MS;
  const rowsAt = 300;
  const chipsAt = 1100;
  const leaveAt = tapAt(PROJECTS_POINTER, 0) + POINTER_REACT_MS;
  const frame = demoFrame(elapsed, [rowsAt, chipsAt, leaveAt]);
  const rowA = played(elapsed, rowsAt, 200);
  const rowB = played(elapsed, rowsAt + 150, 200);
  const rowC = played(elapsed, rowsAt + 300, 200);
  const chips = played(elapsed, chipsAt, 200);
  const leave = exited(elapsed, leaveAt, 250);
  const skeleton = 1 - Math.max(rowA, rowB, rowC);
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-skel" aria-hidden="true" style={styleOf({ "--setup-fade": skeleton })}>
        <Skeleton width="lg" />
        <Skeleton width="md" />
        <Skeleton width="lg" />
      </div>
      <p className="t-label">פרויקטים</p>
      <ProjectRow label="וילה רעננה" amount={rowA} checked={rowA >= 1} />
      <ProjectRow label="בניין מגורים חולון" amount={rowB} checked={rowB >= 1} />
      <ProjectRow label="מגדל משרדים לוד" amount={rowC} checked={chips >= 1} />
      <p className="t-label">קטגוריות</p>
      <div className="ui-setup-pills">
        <ChoiceChip label="חומרים" amount={chips} />
        <ChoiceChip label="קבלני משנה" amount={chips} />
        <ChoiceChip label="שכר" amount={chips} />
        <ChoiceChip label="רכב" amount={chips} />
        {leave < 1 ? <ChoiceChip label="פרסום" amount={chips} leaving={leave} tap="chip" /> : null}
      </div>
      <p className="ui-setup-fade t-hint" data-setup-visible={leave >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": leave })}>
        מוסתרות · <bdi dir="ltr">1</bdi>
      </p>
      <DemoPointer elapsedMs={elapsed} timeline={PROJECTS_POINTER} variant={pointer} />
    </div>
  );
}

function ProjectRow({ label, amount, checked }: { label: string; amount: number; checked: boolean }) {
  if (amount <= 0) return null;
  return (
    <div className="ui-setup-fade" data-setup-visible={amount >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": amount })}>
      <CheckRow label={label} checked={checked} onChange={() => {}} />
    </div>
  );
}

function ChoiceChip({ label, amount, leaving, tap }: { label: string; amount: number; leaving?: number; tap?: string }) {
  if (amount <= 0) return null;
  const leave = leaving ?? 0;
  const leavingChip = leaving !== undefined;
  return (
    <span
      className={leavingChip ? "ui-setup-chip-leave" : "ui-setup-fade"}
      data-tap={tap}
      data-setup-visible={amount >= 1 && leave < 1 ? "true" : "false"}
      style={styleOf(leavingChip ? { "--setup-leave": leave, "--setup-in": amount } : { "--setup-fade": amount })}
    >
      <Chip kind="choice">{label}</Chip>
    </span>
  );
}

export function FirstApprovalDemo({ pointer = "dot" }: { pointer?: DemoPointerVariant }) {
  return (
    <DemoPlayer alt={APPROVAL_ALT} durationMs={APPROVAL_DEMO_MS}>
      <ApprovalScene pointer={pointer} />
    </DemoPlayer>
  );
}

function ApprovalScene({ pointer }: SceneProps) {
  const { progress } = useDemoPlayback();
  const elapsed = progress * APPROVAL_DEMO_MS;
  const leaveAt = tapAt(APPROVAL_POINTER, 0) + POINTER_REACT_MS;
  const frame = demoFrame(elapsed, [leaveAt]);
  const leave = exited(elapsed, leaveAt, 250);
  const next = played(elapsed, leaveAt, 200);
  const count = elapsed > leaveAt ? "11" : "12";
  return (
    <div className="ui-setup-demo ui-setup-approve" data-demo-frame={frame}>
      <div className="ui-setup-head" data-setup-visible="true">
        <p className="t-title-3">לאישור</p>
        <p className="t-hint">
          <bdi dir="ltr" data-demo-count={count}>
            {count}
          </bdi>
          {" נשארו"}
        </p>
      </div>
      <div className="ui-setup-stack">
        <div className="ui-setup-leave" data-setup-visible={leave < 1 ? "true" : "false"} style={styleOf({ "--setup-leave": leave })}>
          <ApprovalCard supplier="חומרי בניין הדר בע״מ" agorot={850_000n} vat="₪1,530" project="וילה רעננה" category="חומרים" tap="approve" />
        </div>
        <div className="ui-setup-fade" data-setup-visible={next >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": next })}>
          <ApprovalCard supplier="אבי חשמל" agorot={234_000n} vat="₪421" project="וילה רעננה" category="קבלני משנה" />
        </div>
      </div>
      <DemoPointer elapsedMs={elapsed} timeline={APPROVAL_POINTER} variant={pointer} />
    </div>
  );
}

function ApprovalCard({ supplier, agorot, vat, project, category, tap }: { supplier: string; agorot: bigint; vat: string; project: string; category: string; tap?: string }) {
  return (
    <div className="ui-setup-card">
      <DemoFact supplier={supplier} date="21/09/2026" agorot={agorot} vat={vat} spark={1} project={project} projectAmount={1} category={category} categoryAmount={1} />
      <div className="ui-setup-hit">
        <Button full icon={<CheckIcon />} data-tap={tap}>
          אישור
        </Button>
      </div>
    </div>
  );
}

function DemoFact({
  supplier,
  date,
  agorot,
  vat,
  spark,
  project,
  projectAmount,
  category,
  categoryAmount,
}: {
  supplier: string;
  date: string;
  agorot: bigint;
  vat: string;
  spark: number;
  project?: string;
  projectAmount: number;
  category?: string;
  categoryAmount: number;
}) {
  return (
    <div className="ui-setup-fact">
      <p className="t-title-3">{supplier}</p>
      <p className="t-hint">
        הוצאה · <bdi dir="ltr">{date}</bdi>
      </p>
      <p className="t-display">
        <bdi dir="ltr">{formatAmount(agorot, "detail")}</bdi>
      </p>
      <p className="t-hint">
        לפני מע״מ · מע״מ <bdi dir="ltr">{vat}</bdi>
      </p>
      <p className="ui-setup-offer ui-setup-fade" data-setup-visible={spark >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": spark })}>
        <SparkIcon size={16} /> הצעה
      </p>
      <OfferLine label="פרויקט" name={project} amount={projectAmount} />
      <OfferLine label="קטגוריה" name={category} amount={categoryAmount} />
    </div>
  );
}

function OfferLine({ label, name, amount }: { label: string; name?: string; amount: number }) {
  return (
    <div className="ui-setup-offer-line">
      <span className="t-label">{label}</span>
      {name != null && amount > 0 ? (
        <span className="ui-setup-pill ui-setup-fade" data-setup-visible={amount >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": amount })}>
          {name}
        </span>
      ) : (
        <span className="t-hint">—</span>
      )}
    </div>
  );
}

export function IosInstallDemo({ pointer = "dot" }: { pointer?: DemoPointerVariant }) {
  return (
    <DemoPlayer alt={IOS_ALT} durationMs={IOS_DEMO_MS}>
      <IosScene pointer={pointer} />
    </DemoPlayer>
  );
}

function IosScene({ pointer }: SceneProps) {
  const { progress } = useDemoPlayback();
  const elapsed = progress * IOS_DEMO_MS;
  const menuAt = tapAt(IOS_POINTER, 0) + POINTER_REACT_MS;
  const shareAt = tapAt(IOS_POINTER, 1) + POINTER_REACT_MS;
  const addAt = tapAt(IOS_POINTER, 2) + POINTER_REACT_MS;
  const homeAt = tapAt(IOS_POINTER, 3) + POINTER_REACT_MS;
  const frame = demoFrame(elapsed, [menuAt, shareAt, addAt, homeAt]);
  const bar = elapsed < menuAt ? 1 : 0;
  const menu = elapsed > menuAt && elapsed < shareAt ? played(elapsed, menuAt, 200) : 0;
  const share = elapsed > shareAt && elapsed < addAt ? played(elapsed, shareAt, 200) : 0;
  const add = elapsed > addAt && elapsed < homeAt ? played(elapsed, addAt, 200) : 0;
  const home = elapsed > homeAt ? played(elapsed, homeAt, 250) : 0;
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-safari-bar ui-setup-dock ui-setup-panel" dir="ltr" data-setup-visible={bar >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": bar })}>
        <ChevronIcon size={18} />
        <HostLine />
        <span className="ui-setup-hit" data-tap="more">
          <bdi dir="ltr">•••</bdi>
        </span>
      </div>
      <MenuPanel amount={menu} open={elapsed > menuAt && elapsed < shareAt} rows={[["העתקת הקישור", false], ["שיתוף", true], ["הוספה למועדפים", false]]} icon={<ShareIcon />} tap="share" />
      <MenuPanel amount={share} open={elapsed > shareAt && elapsed < addAt} rows={[["העתקה", false], ["הוספה למסך הבית", true], ["הדפסה", false]]} icon={<SquarePlusIcon />} tap="addhome" />
      <div className="ui-setup-add ui-setup-panel" data-setup-visible={elapsed > addAt && elapsed < homeAt ? "true" : "false"} style={styleOf({ "--setup-opacity": add })}>
        <AppIcon size="note" />
        <TextField label="שם" value="Flow" readOnly onChange={() => {}} />
        <Toggle label="פתיחה כאפליקציה" checked={add >= 1} onChange={() => {}} />
        <div className="ui-setup-hit">
          <Button variant="pill" data-tap="add">
            הוספה
          </Button>
        </div>
      </div>
      <HomeGrid amount={home} open={elapsed > homeAt} />
      <DemoPointer elapsedMs={elapsed} timeline={IOS_POINTER} variant={pointer} />
    </div>
  );
}

function MenuPanel({ amount, open, rows, icon, tap }: { amount: number; open: boolean; rows: Array<[string, boolean]>; icon: ReactNode; tap: string }) {
  return (
    <div className="ui-setup-menu ui-setup-panel" data-setup-visible={open ? "true" : "false"} style={styleOf({ "--setup-opacity": amount })}>
      {rows.map(([label, on]) => (
        <div className="ui-setup-menu-row" data-on={on ? "true" : "false"} data-tap={on ? tap : undefined} key={label}>
          {on ? icon : null}
          {label}
        </div>
      ))}
    </div>
  );
}

export function AndroidInstallDemo({ pointer = "dot" }: { pointer?: DemoPointerVariant }) {
  return (
    <DemoPlayer alt={ANDROID_ALT} durationMs={ANDROID_DEMO_MS}>
      <AndroidScene pointer={pointer} />
    </DemoPlayer>
  );
}

function AndroidScene({ pointer }: SceneProps) {
  const { progress } = useDemoPlayback();
  const elapsed = progress * ANDROID_DEMO_MS;
  const dialogAt = tapAt(ANDROID_POINTER, 0) + POINTER_REACT_MS;
  const homeAt = tapAt(ANDROID_POINTER, 1) + POINTER_REACT_MS;
  const frame = demoFrame(elapsed, [dialogAt, homeAt]);
  const button = elapsed < dialogAt ? 1 : 0;
  const dialog = elapsed > dialogAt && elapsed < homeAt ? played(elapsed, dialogAt, 280) : 0;
  const home = elapsed > homeAt ? played(elapsed, homeAt, 250) : 0;
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-layer ui-setup-panel" data-setup-visible={button >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": button })}>
        <div className="ui-setup-hit">
          <Button full data-tap="install">
            התקנה
          </Button>
        </div>
      </div>
      <div className="ui-setup-scrim" style={styleOf({ "--setup-opacity": dialog })} />
      <div className="ui-setup-dialog ui-setup-dock ui-setup-rise" data-setup-visible={elapsed > dialogAt && elapsed < homeAt ? "true" : "false"} style={styleOf({ "--setup-rise": dialog })}>
        <p className="t-title-3">להתקין את Flow?</p>
        <HostLine />
        <div className="ui-setup-actions">
          <Button variant="secondary">ביטול</Button>
          <div className="ui-setup-hit">
            <Button full data-tap="confirm">
              התקנה
            </Button>
          </div>
        </div>
      </div>
      <HomeGrid amount={home} open={elapsed > homeAt} />
      <DemoPointer elapsedMs={elapsed} timeline={ANDROID_POINTER} variant={pointer} />
    </div>
  );
}

function HomeGrid({ amount, open }: { amount: number; open: boolean }) {
  return (
    <div className="ui-setup-home ui-setup-layer ui-setup-panel" dir="ltr" data-setup-visible={open ? "true" : "false"} style={styleOf({ "--setup-opacity": amount })}>
      {HOME_BEFORE.map((slot) => (
        <span className="ui-setup-tile" key={slot} />
      ))}
      <span className="ui-setup-icon ui-setup-land" style={styleOf({ "--setup-land": amount })}>
        <AppIcon size="note" />
        <span className="ui-setup-cap" dir="rtl">
          Flow
        </span>
      </span>
      <span className="ui-setup-tile" />
    </div>
  );
}
