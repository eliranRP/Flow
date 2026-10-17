import { lazy, useState } from "react";
import { ReviewSegments } from "../../ui/review-count";
import { ReviewCard } from "../../ui/review-card";
import { ScreenHeader } from "../../ui/screen-header";
import { useToast } from "../../ui/toast";
import { ActionBar, ActionBarRow } from "../../ui/action-bar";
import { Button } from "../../ui/button";
import { CheckIcon } from "../../ui/icons";
import { DEV_FILED_ROWS, FiledTodayScreen, ReviewQueue } from "../../screens/flow-screens";
import { ChangeAssignment } from "../../ui/change-sheet";
import { DevTxnList, DevTxnPagedList } from "../txn-lists";
import type { DevRoute } from "./types";

export { DevTxnList, DevTxnPagedList };

const JevReviewE2e = /* @__PURE__ */ lazy(() => import("../../screens/jev-review-card").then((m) => ({ default: m.JevReviewE2e })));

const devReviewItems = [
  {
    id: "1",
    supplier: "חומרי בניין לדוגמה בע״מ",
    project: "שיפוץ הרצל 12",
    category: "חומרים",
    netAgorot: -1_600_000n,
  },
  {
    id: "2",
    supplier: "הובלות לדוגמה",
    project: "וילה רעננה",
    category: "הובלה",
    netAgorot: -400_000n,
  },
];

/** A local queue for the review card, so approve and skip can be tried without writing a review row. */
export function DevReview() {
  const toast = useToast();
  const [items, setItems] = useState(devReviewItems);
  const [index] = useState(0);
  const [change, setChange] = useState(false);
  const item = items[index];
  const total = items.length;
  return (
    <div className="ui-review-queue" data-bar="">
      <ScreenHeader title="לאישור" subtitle="תנועות שמחכות לשיוך" />
      <ReviewSegments index={Math.min(index + 1, total)} total={total} />
      <p className="t-hint ui-review-counter">
        <bdi dir="ltr">{String(Math.min(index + 1, total))}</bdi>
        {" מתוך "}
        <bdi dir="ltr">{String(total)}</bdi>
      </p>
      {item ? (
        <div className="ui-review-motion" data-motion={index === 0 ? undefined : "in"} key={item.id}>
          <ReviewCard
            supplier={item.supplier}
            sourceLine="הוצאה · 20/06/2026"
            netAgorot={item.netAgorot}
            vatLine="לפני מע״מ"
            suggestion={{ project: item.project, category: item.category }}
          />
        </div>
      ) : (
        <p className="ui-page-pad t-title-3">אין פריטים לאישור</p>
      )}
      <ActionBar>
        <Button
          full
          icon={<CheckIcon />}
          disabled={!item}
          onClick={() => {
            if (!item) return;
            const at = index;
            setItems((list) => list.filter((_, position) => position !== at));
            toast.show({
              message: "הפריט אושר",
              action: "ביטול",
              place: "bar",
              onAction: () => {
                setItems((list) => [...list.slice(0, at), item, ...list.slice(at)]);
              },
            });
          }}
        >
          אישור
        </Button>
        <ActionBarRow>
          <Button variant="secondary" onClick={() => { setChange(true); }}>שינוי</Button>
          <Button
            variant="ghost"
            disabled={!item}
            onClick={() => {
              if (!item) return;
              // FLOW-365: דלג moves the card to the end of the device order. It writes nothing and shows no toast.
              const at = index;
              setItems((list) => [...list.filter((_, position) => position !== at), item]);
            }}
          >
            דלג
          </Button>
        </ActionBarRow>
      </ActionBar>
      {change ? <p className="ui-page-pad">השינוי נפתח</p> : null}
    </div>
  );
}

export function DevReviewBanner() {
  return (
    <ReviewQueue
      sample
      search="?preview=1&sample=1"
      rows={[{
        id: "q1",
        transaction_id: "t1",
        description: "מלט",
        doc_date: "2026-09-29",
        amount_net: -350_000n,
        direction: "expense",
        reason: "missing_category",
        project_id: "p1",
        category_id: "c1",
        supplier_name: "מנופים לדוגמה בע״מ",
        project_name: "שיפוץ הרצל 12",
        category_name: "חומרים",
        // FLOW-309: the banner counts the rows the list it opens shows, as live does.
        auto_approved_today: DEV_FILED_ROWS.length,
      }]}
    />
  );
}

/** Two projects and a line with none, so the list shows its project heads (FLOW-334). */
export function DevFiled() {
  return (
    <FiledTodayScreen
      sample={[
        { id: "t-filed", description: "מלט", doc_date: "2026-09-29", amount_net: -350_000n, direction: "expense", supplier_name: "מנופים לדוגמה בע״מ", project_name: "שיפוץ הרצל 12", category_name: "חומרים" },
        { id: "t-filed-2", description: "הובלה", doc_date: "2026-09-29", amount_net: -120_000n, direction: "expense", supplier_name: "הובלות לדוגמה", project_name: "וילה רעננה", category_name: "הובלה" },
        { id: "t-filed-3", description: "צבע", doc_date: "2026-09-29", amount_net: -84_050n, direction: "expense", supplier_name: "צבעים לדוגמה", project_name: "שיפוץ הרצל 12", category_name: "חומרים" },
        { id: "t-filed-4", description: "עמלה", doc_date: "2026-09-29", amount_net: -2_500n, direction: "expense", supplier_name: "עמלת בנק", project_name: null, category_name: "עמלות" },
      ]}
    />
  );
}

export function DevChange() {
  const toast = useToast();
  const [projectId, setProjectId] = useState("p1");
  const [categoryId, setCategoryId] = useState("c1");
  const [remember, setRemember] = useState(true);
  const [projects, setProjects] = useState([
    { id: "p1", name: "שיפוץ הרצל 12" },
    { id: "p2", name: "וילה רעננה" },
  ]);
  return (
    <ChangeAssignment
      host="route"
      closeTo="/review?preview=1"
      supplier="מנופים לדוגמה בע״מ"
      amount="₪3,500"
      direction="expense"
      projects={projects}
      categories={[
        { id: "c1", name: "חומרים" },
        { id: "c2", name: "הובלה" },
      ]}
      projectId={projectId}
      categoryId={categoryId}
      suggestionProjectId="p1"
      suggestionCategoryId="c1"
      onProjectId={setProjectId}
      onCategoryId={setCategoryId}
      remember={remember}
      onRemember={setRemember}
      pending={!remember}
      onCommitPick={() => {
        toast.show({ message: "השיוך נשמר" });
        return Promise.resolve(undefined);
      }}
      onCommitPending={() => {
        toast.show({ message: "השיוך נשמר" });
        return Promise.resolve();
      }}
      onSplit={() => {
        toast.show({ message: "הפיצול נעשה ממסך התנועה, אחרי השיוך." });
      }}
      onCreateProject={(name) => {
        const created = { id: `new-${name}`, name, status: "active" as const };
        setProjects((list) => [...list, created]);
        toast.show({ message: "הפרויקט נשמר" });
        return Promise.resolve(created);
      }}
    />
  );
}

export const reviewRoutes: DevRoute[] = [
  { path: "review", element: <DevReview /> },
  { path: "jev-review", element: <JevReviewE2e /> },
  { path: "review-banner", element: <DevReviewBanner /> },
  { path: "filed", element: <DevFiled /> },
  { path: "txn-list", element: <DevTxnList /> },
  { path: "txn-paged", element: <DevTxnPagedList /> },
  { path: "change", element: <DevChange /> },
];
