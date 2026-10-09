import { type CategoryRow } from "@flow/shared";
import { useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useHoldWrites } from "../use-is-viewer";
import { getSupabase } from "../lib/supabase";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useCategoriesQuery, useDashboardQuery } from "../use-books";
import { assertNoError, useWrite } from "../use-write";
import { mergeFailureText, pnlFailureText } from "../category-copy";
import { Button } from "../ui/button";
import { ConfirmSheet } from "../ui/confirm-sheet";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { ChevronDownIcon, KeptOutIcon, MoreIcon, PlusIcon, TagIcon } from "../ui/icons";
import { KeptOutTag } from "../ui/line-marks";
import { EMPTY_FILTERS, searchFiltersQuery } from "../search";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { SegmentedControl } from "../ui/segmented-control";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { useToast } from "../ui/toast";
import { CategoryMenuSheet } from "./category-sheet";
import { KEPT_OUT, useBlockedPreview } from "./screen-shared";

/** The three loan categories the server keeps fixed, by `loan_part`, and whether each counts in the P&L (decision 0099). */
const LOAN_CATEGORY_LINES: Record<string, string> = {
  interest: "חלק מתשלום הלוואה\u00a0· תמיד נספרת ברווח",
  escrow: "חלק מתשלום הלוואה\u00a0· תמיד נספרת ברווח",
  principal: "קטגוריית הלוואה\u00a0· לא נספרת ברווח",
};

function loanCategoryLine(category: CategoryRow): string | null {
  return category.loan_part ? (LOAN_CATEGORY_LINES[category.loan_part] ?? null) : null;
}

type PnlChange = { id: string; name: string; excluded: boolean; undo: boolean };

function CategoryLine({
  category,
  muted = false,
  plain = false,
  href,
  onMenu,
}: {
  category: CategoryRow & { count?: number };
  /** FLOW-322: the category's lines, in search. */
  href?: string;
  muted?: boolean;
  /** A viewer row keeps the height and drops the pointer. */
  plain?: boolean;
  onMenu?: (opener: HTMLElement) => void;
}) {
  return (
    <ListRow
      variant="item"
      plain={plain && href == null}
      href={href}
      title={category.name}
      muted={muted}
      meta={category.count == null ? undefined : category.count === 1 ? "תנועה אחת" : `${String(category.count)} תנועות`}
      tag={category.excluded_from_pnl === true ? <KeptOutTag label={KEPT_OUT} /> : undefined}
      action={onMenu == null ? undefined : (
        <IconButton
          label={`עוד, ${category.name}`}
          onClick={(event) => { onMenu(event.currentTarget); }}
        >
          <MoreIcon />
        </IconButton>
      )}
    />
  );
}

export function CategoriesScreen({
  sample,
  hiddenOpen = false,
}: {
  sample?: Array<CategoryRow & { count?: number }>;
  /** Stories open the hidden list without a click. */
  hiddenOpen?: boolean;
} = {}) {
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const [params] = useSearchParams();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  const categories = useCategoriesQuery(sample == null);
  const dashboard = useDashboardQuery(sample == null && preview === "off");
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, categories);
  const rows: Array<CategoryRow & { count?: number }> = sample ?? categories.data ?? [];
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [showHidden, setShowHidden] = useState(hiddenOpen);
  const [menu, setMenu] = useState<(CategoryRow & { count?: number }) | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mergeFrom, setMergeFrom] = useState("");
  const [mergeInto, setMergeInto] = useState("");
  const [hideTarget, setHideTarget] = useState<CategoryRow | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const toast = useToast();
  // FLOW-322: a category row opens that category's lines, every period, in search.
  const linesHref = (category: CategoryRow) =>
    `/search${searchFiltersQuery({ ...EMPTY_FILTERS, category: category.id, direction: category.kind }, new URLSearchParams(search))}`;
  const menuOpener = useRef<HTMLElement | null>(null);
  // FLOW-310: ✕ and Escape on the new-category sheet return focus to its link.
  const createOpener = useRef<HTMLButtonElement>(null);
  const pnl = useWrite<PnlChange>({
    failure: pnlFailureText,
    keys: ["categories", "dashboard", "project", "project-category"],
    onSuccess: (done) => {
      setMenu(null);
      toast.show({
        message: `${done.name} · ${done.excluded ? KEPT_OUT : "נספר ברווח"}`,
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => { pnl.mutate({ ...done, excluded: !done.excluded, undo: true }); },
        }),
      });
    },
    run: async (change) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_category_excluded_from_pnl", { p_id: change.id, p_excluded: change.excluded }));
    },
  });
  const createCategory = useWrite({
    failure: (error) => (error.message.includes("already") ? "יש כבר קטגוריה בשם הזה." : "לא הצלחנו ליצור את הקטגוריה."),
    success: "הקטגוריה נשמרה",
    keys: ["categories"],
    onSuccess: () => {
      setCreateOpen(false);
      setCategoryName("");
    },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("create_category", { p_name: categoryName, p_kind: kind }));
    },
  });
  const hide = useWrite({
    failure: "לא הצלחנו לעדכן את הקטגוריה.",
    keys: ["categories"],
    onSuccess: () => { setHideTarget(null); },
    run: async () => {
      if (!hideTarget) throw new Error("missing");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_category_hidden", { p_id: hideTarget.id, p_hidden: !hideTarget.hidden }));
    },
  });
  const merge = useWrite({
    failure: mergeFailureText,
    success: "הקטגוריות מוזגו",
    keys: ["categories", "dashboard"],
    onSuccess: () => { setMergeOpen(false); },
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("merge_category", { p_from: mergeFrom, p_into: mergeInto }));
    },
  });
  const fromName = rows.find((category) => category.id === mergeFrom)?.name ?? "";
  const intoName = rows.find((category) => category.id === mergeInto)?.name ?? "";
  const shown = rows.filter((category) => category.kind === kind && !category.hidden);
  const hiddenRows = rows.filter((category) => category.kind === kind && category.hidden);
  const hiddenExpanded = showHidden && hiddenRows.length > 0;
  const anyKeptOut = rows.some((category) => category.kind === kind && category.excluded_from_pnl === true);
  // Follow the refetched row, so the rehab switch shows the saved value while the sheet stays open.
  const menuRow = menu ? rows.find((row) => row.id === menu.id) ?? menu : null;
  const menuLoanLine = menuRow ? loanCategoryLine(menuRow) : null;
  const previewNoCompany = sample == null && params.get("preview") === "empty";
  const liveNoCompany = sample == null && preview === "off" && dashboard.isSuccess && dashboard.data.company_id == null;
  if (previewNoCompany || liveNoCompany) {
    return <Navigate to={`/settings${search}`} replace />;
  }
  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title="קטגוריות"
        kicker="הגדרות"
        backTo={`/settings${search}`}
        phase={phase}
        onRetry={() => { void categories.refetch(); }}
      />
    );
  }
  return (
    <div>
      <ScreenHeader title="קטגוריות" kicker="הגדרות" backTo={`/settings${search}`} />
      <div className="ui-page-pad ui-cat-seg">
        <SegmentedControl
          label="סוג"
          showLabel={false}
          radius="input"
          value={kind}
          onChange={(next) => {
            setKind(next);
            setShowHidden(false);
          }}
          options={[
            { value: "expense", label: "הוצאות" },
            { value: "income", label: "הכנסות" },
          ]}
        />
      </div>
      {shown.length === 0 && hiddenRows.length === 0 ? (
        <EmptyState icon={<TagIcon />} title="אין עדיין קטגוריות" body="קטגוריות נוצרות מהמסמכים של SUMIT או כשמוסיפים אחת" />
      ) : shown.length > 0 ? (
      <List className="ui-cat-list">
        {shown.map((category) => (
          <CategoryLine
            key={category.id}
            category={category}
            plain={holdWrites}
            href={linesHref(category)}
            onMenu={holdWrites ? undefined : (opener) => {
              menuOpener.current = opener;
              setMenu(category);
            }}
          />
        ))}
      </List>
      ) : null}
      <div className="ui-cat-foot">
        {holdWrites ? null : (
        <TextLink
          chevron={false}
          wrap
          buttonRef={createOpener}
          icon={<PlusIcon size={16} stroke={2.2} />}
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          קטגוריה חדשה
        </TextLink>
        )}
        {hiddenRows.length > 0 ? (
          <TextLink
            tone="quiet"
            chevron={false}
            wrap
            className="ui-cat-foot-end"
            expanded={hiddenExpanded}
            controls="categories-hidden"
            trailing={<ChevronDownIcon size={16} />}
            onClick={() => {
              setShowHidden((current) => !current);
            }}
          >
            מוסתרות · <bdi className="ui-num">{String(hiddenRows.length)}</bdi>
          </TextLink>
        ) : null}
      </div>
      {hiddenRows.length > 0 ? (
        <div id="categories-hidden" hidden={!hiddenExpanded}>
          {hiddenExpanded ? (
            <List className="ui-cat-list ui-cat-hidden">
              {hiddenRows.map((category) => (
                <CategoryLine
                  key={category.id}
                  category={category}
                  muted
                  plain={holdWrites}
                  href={linesHref(category)}
                  onMenu={holdWrites ? undefined : (opener) => {
                    menuOpener.current = opener;
                    setMenu(category);
                  }}
                />
              ))}
            </List>
          ) : null}
        </div>
      ) : null}
      {anyKeptOut ? (
        <p className="t-hint ui-page-pad ui-cat-legend">
          <KeptOutIcon size={14} />
          {KEPT_OUT}
        </p>
      ) : null}
      <CategoryMenuSheet
        category={menuRow}
        rows={rows}
        loanLine={menuLoanLine}
        pnlBusy={pnl.isPending}
        blocked={blocked}
        returnFocusRef={menuOpener}
        onClose={() => { setMenu(null); }}
        onPnl={(category) => {
          pnl.mutate({ id: category.id, name: category.name, excluded: category.excluded_from_pnl !== true, undo: false });
        }}
        onHide={(category) => {
          setHideTarget(category);
          setMenu(null);
        }}
        onMerge={(from, into) => {
          setMergeFrom(from.id);
          setMergeInto(into.id);
          setMergeOpen(true);
        }}
      />
      <Sheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="קטגוריה חדשה"
        returnFocusRef={createOpener}
        action={
          <Button
            busy={createCategory.isPending}
            onClick={() => {
              if (blocked()) return;
              createCategory.mutate();
            }}
          >
            שמירה
          </Button>
        }
      >
        <TextField label="שם" value={categoryName} onChange={(event) => { setCategoryName(event.target.value); }} />
      </Sheet>
      <ConfirmSheet
        open={hideTarget != null}
        onOpenChange={(open) => { if (!open) setHideTarget(null); }}
        title={hideTarget?.hidden ? "להחזיר את הקטגוריה לרשימה?" : "להסתיר את הקטגוריה?"}
        item={hideTarget?.name}
        consequence={hideTarget?.hidden ? "הקטגוריה תופיע שוב ברשימה." : "הקטגוריה לא נמחקת. אפשר להחזיר אותה מ״מוסתרות״."}
        // FLOW-341: hiding can be undone, so its button is neutral; the bin stays on real deletes.
        confirmLabel={hideTarget?.hidden ? "החזרה לרשימה" : "הסתרה"}
        busy={hide.isPending}
        returnFocusRef={menuOpener}
        onConfirm={() => {
          if (blocked()) return;
          hide.mutate();
        }}
      />
      <ConfirmSheet
        open={mergeOpen}
        onOpenChange={setMergeOpen}
        title="למזג את הקטגוריה?"
        item={`${fromName} ← ${intoName}`}
        consequence={`התנועות עוברות אל היעד, ו${fromName} מוסתרת. אי אפשר להפריד אחר כך.`}
        confirmLabel="מיזוג"
        destructive
        icon={null}
        busy={merge.isPending}
        returnFocusRef={menuOpener}
        onConfirm={() => {
          if (blocked()) return;
          merge.mutate();
        }}
      />
    </div>
  );
}
