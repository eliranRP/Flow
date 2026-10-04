import { type CSSProperties } from "react";
import { MemoryRouter } from "react-router-dom";
import { Button } from "./button";
import { CheckRow } from "./check-row";
import { Chip } from "./chip";
import { DemoPlayer, useDemoPlayback } from "./demo-player";
import { AppIcon, CheckIcon, ShareIcon, SquarePlusIcon, TagIcon } from "./icons";
import { ListRow } from "./list-row";
import { ReviewCard } from "./review-card";
import { Skeleton } from "./skeleton";
import { SuggestTag } from "./suggest-tag";
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

const EXAMPLE = "נתוני דוגמה · Example data";

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

function ExampleLine() {
  return <p className="ui-setup-example">{EXAMPLE}</p>;
}

function HostLine() {
  return (
    <span className="ui-setup-host">
      <bdi dir="ltr">{demoHost()}</bdi>
    </span>
  );
}

export function SumitConnectDemo() {
  return (
    <DemoPlayer alt={SUMIT_ALT} durationMs={SUMIT_DEMO_MS}>
      <SumitScene />
    </DemoPlayer>
  );
}

function SumitScene() {
  const { progress } = useDemoPlayback();
  const frame = demoFrame(progress, [0.25, 0.55, 0.8]);
  const fill = demoBeat(progress, 0.04, 0.22);
  const press = demoBeat(progress, 0.25, 0.29);
  const sheetOut = easeExit(demoBeat(progress, 0.55, 0.605));
  const hello = demoBeat(progress, 0.6, 0.68);
  const line1 = demoBeat(progress, 0.68, 0.71);
  const line2 = demoBeat(progress, 0.71, 0.74);
  const line3 = demoBeat(progress, 0.74, 0.77);
  const company = "1001".slice(0, Math.round(fill * 4));
  const secret = "demo".slice(0, Math.round(fill * 4));
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <ExampleLine />
      <div className="ui-setup-stack">
        <div
          className="ui-setup-sheet"
          data-setup-visible={sheetOut < 1 ? "true" : "false"}
          style={styleOf({ "--setup-out": sheetOut, "--setup-opacity": 1 - sheetOut })}
        >
          <p className="t-title-3">
            חיבור <bdi dir="ltr">SUMIT</bdi>
          </p>
          <TextField label="מספר חברה" value={company} inputMode="numeric" readOnly onChange={() => {}} />
          <TextField label="מפתח API" type="password" value={secret} readOnly autoComplete="off" onChange={() => {}} />
          <div className="ui-setup-hit">
            <Button full busy={progress >= 0.3 && progress < 0.55} className={press >= 1 ? "ui-setup-pressed" : undefined}>
              חיבור
            </Button>
          </div>
        </div>
        <div className="ui-setup-result" data-setup-visible={hello >= 1 ? "true" : "false"}>
          <p className="ui-setup-drop t-title-3" style={styleOf({ "--setup-drop": hello })}>
            <bdi dir="ltr">SUMIT</bdi>
            {" מחובר"}
          </p>
          <SumitLine title="ספק לדוגמה בע״מ" hint="01/09" agorot={850_000n} drop={line1} />
          <SumitLine title="ספק שני לדוגמה" hint="02/09" agorot={120_000n} drop={line2} />
          <SumitLine title="ספק שלישי לדוגמה" hint="03/09" agorot={64_000n} drop={line3} />
          <MemoryRouter initialEntries={["/review"]}>
            <TabBar reviewCount={demoBeat(progress, 0.8, 0.9) >= 1 ? 12 : 0} />
          </MemoryRouter>
        </div>
      </div>
    </div>
  );
}

function SumitLine({ title, hint, agorot, drop }: { title: string; hint: string; agorot: bigint; drop: number }) {
  return (
    <div className="ui-setup-drop" style={styleOf({ "--setup-drop": drop })}>
      <ListRow variant="transaction" title={title} hint={hint} agorot={agorot} sign="out" source="invoice" />
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
  const tag = demoBeat(progress, 0.25, 0.42);
  const project = demoBeat(progress, 0.5, 0.66);
  const category = demoBeat(progress, 0.75, 0.9);
  return (
    <div className="ui-setup-demo ui-setup-jev" data-demo-frame={frame}>
      <ExampleLine />
      <ReviewCard
        supplier="ספק לדוגמה בע״מ"
        sourceLine="חשבונית · 01/09/2026"
        netAgorot={850_000n}
        vatLine="לפני מע״מ"
      />
      <div className="ui-setup-fade" data-setup-visible={tag >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": tag })}>
        <SuggestTag />
      </div>
      <div className="ui-setup-pills">
        <span className="ui-setup-fade" data-setup-visible={project >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": project })}>
          <Chip kind="suggested">פרויקט לדוגמה</Chip>
        </span>
        <span className="ui-setup-fade" data-setup-visible={category >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": category })}>
          <Chip kind="suggested">קטגוריה לדוגמה</Chip>
        </span>
      </div>
      <Toggle label="תיוג חכם (Jev)" hint="ההצעות נשמרות לבדיקה ולא ממולאות אוטומטית." icon={<TagIcon />} checked={tag >= 1} onChange={() => {}} />
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
  const rowA = demoBeat(progress, 0.22, 0.34);
  const rowB = demoBeat(progress, 0.34, 0.46);
  const chipA = demoBeat(progress, 0.46, 0.54);
  const chipB = demoBeat(progress, 0.54, 0.62);
  const chipC = demoBeat(progress, 0.62, 0.7);
  const leave = demoBeat(progress, 0.74, 0.9);
  const skeleton = 1 - Math.max(rowA, rowB);
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <ExampleLine />
      <div className="ui-setup-skel" aria-hidden="true" style={styleOf({ "--setup-fade": skeleton })}>
        <Skeleton width="lg" />
        <Skeleton width="md" />
        <Skeleton width="lg" />
      </div>
      <div className="ui-setup-fade" data-setup-visible={rowA >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": rowA })}>
        <CheckRow label="פרויקט לדוגמה" checked={rowA >= 1} onChange={() => {}} />
      </div>
      <div className="ui-setup-fade" data-setup-visible={rowB >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": rowB })}>
        <CheckRow label="פרויקט שני לדוגמה" checked={rowB >= 1} onChange={() => {}} />
      </div>
      <div className="ui-setup-pills">
        <span className="ui-setup-fade" data-setup-visible={chipA >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": chipA })}>
          <Chip kind="choice">קטגוריה א׳</Chip>
        </span>
        <span className="ui-setup-fade" data-setup-visible={chipB >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": chipB })}>
          <Chip kind="choice">קטגוריה ב׳</Chip>
        </span>
        <span className="ui-setup-chip-leave" data-setup-visible={chipC >= 1 && leave < 1 ? "true" : "false"} style={styleOf({ "--setup-leave": leave, "--setup-in": chipC })}>
          <Chip kind="choice">קטגוריה ג׳</Chip>
        </span>
      </div>
      <p className="ui-setup-fade t-hint" data-setup-visible={leave >= 1 ? "true" : "false"} style={styleOf({ "--setup-fade": leave })}>
        מוסתרות · <bdi dir="ltr">1</bdi>
      </p>
    </div>
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
  const frame = demoFrame(progress, [0.22, 0.32, 0.42]);
  const ring = frame === 1 ? demoBeat(progress, 0.22, 0.2575) : 0;
  const press = demoBeat(progress, 0.25, 0.275);
  const leave = easeExit(demoBeat(progress, 0.32, 0.3825));
  const next = demoBeat(progress, 0.4, 0.58);
  const count = leave >= 1 ? "11" : "12";
  return (
    <div className="ui-setup-demo ui-setup-approve" data-demo-frame={frame}>
      <ExampleLine />
      <p className="ui-setup-count t-title-3">
        <bdi dir="ltr" data-demo-count={count}>{count}</bdi>
      </p>
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
      <ReviewCard supplier={supplier} sourceLine="חשבונית · 01/09/2026" netAgorot={agorot} vatLine="לפני מע״מ" />
      <div className="ui-setup-hit">
        <span className="ui-setup-ring" style={styleOf({ "--setup-ring": ring })} />
        <Button full icon={<CheckIcon />} className={pressed ? "ui-setup-pressed" : undefined}>
          אישור
        </Button>
      </div>
    </div>
  );
}

export function IosInstallDemo() {
  return (
    <DemoPlayer alt={IOS_ALT} durationMs={IOS_DEMO_MS}>
      <IosScene />
    </DemoPlayer>
  );
}

function IosScene() {
  const { progress } = useDemoPlayback();
  const frame = demoFrame(progress, [0.25, 0.5, 0.75]);
  const bar = hold(progress, 0, 0.75);
  const menu = hold(progress, 0.25, 0.5);
  const share = hold(progress, 0.5, 0.75);
  const add = hold(progress, 0.75, 1);
  const ring = frame === 4 ? 1 : frame === 1 ? demoBeat(progress, 0.06, 0.14) : 0;
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-safari" dir="ltr">
        <div className="ui-setup-safari-bar ui-setup-panel" data-setup-visible={bar >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": bar })}>
          <HostLine />
          <span className="ui-setup-dots">
            <bdi dir="ltr">•••</bdi>
          </span>
          <span className="ui-setup-ring" style={styleOf({ "--setup-ring": frame === 1 ? ring : 0 })} />
        </div>
        <div className="ui-setup-menu ui-setup-panel" data-setup-visible={menu >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": menu })}>
          <div className="ui-setup-menu-row" data-on="true">
            <ShareIcon />
            שיתוף
          </div>
        </div>
        <div className="ui-setup-menu ui-setup-panel" data-setup-visible={share >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": share })}>
          <div className="ui-setup-menu-row" data-on="true">
            <SquarePlusIcon />
            הוספה למסך הבית
          </div>
        </div>
        <div className="ui-setup-add ui-setup-panel" data-setup-visible={add >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": add })}>
          <p className="t-title-3">הוספה למסך הבית</p>
          <HostLine />
          <Toggle label="פתיחה כאפליקציה" checked={add >= 1} onChange={() => {}} />
          <div className="ui-setup-hit">
            <span className="ui-setup-ring" style={styleOf({ "--setup-ring": frame === 4 ? ring : 0 })} />
            <Button full>הוספה</Button>
          </div>
        </div>
      </div>
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
  const frame = demoFrame(progress, [0.33, 0.66]);
  const ring = frame === 1 ? demoBeat(progress, 0.06, 0.16) : 0;
  const rise = easeExit(demoBeat(progress, 0.33, 0.423));
  const land = demoBeat(progress, 0.66, 0.86);
  const buttonOpacity = frame === 1 ? 1 : 1 - rise;
  return (
    <div className="ui-setup-demo" data-demo-frame={frame}>
      <div className="ui-setup-stack">
        <div className="ui-setup-hit ui-setup-panel" data-setup-visible={buttonOpacity >= 0.5 ? "true" : "false"} style={styleOf({ "--setup-opacity": buttonOpacity })}>
          <span className="ui-setup-ring" style={styleOf({ "--setup-ring": ring })} />
          <Button full>התקנה</Button>
        </div>
        <div
          className="ui-setup-dialog ui-setup-rise"
          dir="ltr"
          data-setup-visible={rise >= 0.5 && land < 0.5 ? "true" : "false"}
          style={styleOf({ "--setup-rise": rise * (1 - land) })}
        >
          <AppIcon />
          <HostLine />
          <p className="t-title-3">התקנה</p>
        </div>
        <div className="ui-setup-home ui-setup-panel" data-setup-visible={land >= 1 ? "true" : "false"} style={styleOf({ "--setup-opacity": land })}>
          <span className="ui-setup-tile" />
          <span className="ui-setup-icon ui-setup-land" style={styleOf({ "--setup-land": land })}>
            <AppIcon size="note" />
            <HostLine />
          </span>
          <span className="ui-setup-tile" />
        </div>
      </div>
    </div>
  );
}
