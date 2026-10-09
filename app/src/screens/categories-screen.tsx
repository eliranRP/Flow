import { type CategoryRow } from "@flow/shared";
import { useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
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

type ListedCategory = CategoryRow & { count?: number };

/** A category's line count: a sample's `count`, else list_categories' `lines` (FLOW-406, mockup cat-b). */
function lineCount(category: ListedCategory): number | undefined {
  return category.count ?? category.lines;
}

function countLine(count: number): string {
  return count === 1 ? "תנועה אחת" : `${String(count)} תנועות`;
}

/**
 * FLOW-406 (decision 0164, mockup cat-b): the top of the list holds the categories with no parent.
 * A sub-category of a hidden parent is listed there too, as the server keeps it visible.
 */
export function topLevelCategories(rows: readonly ListedCategory[]): ListedCategory[] {
  const hiddenParents = new Set(rows.filter((row) => row.hidden).map((row) => row.id));
  const ids = new Set(rows.map((row) => row.id));
  return rows.filter((row) => row.parent_id == null || hiddenParents.has(row.parent_id) || !ids.has(row.parent_id));
}

function CategoryLine({
  category,
  muted = false,
  plain = false,
  href,
  subCount,
  onMenu,
}: {
  category: ListedCategory;
  /** FLOW-322: the category's lines, in search. A parent's opens its sub-categories (FLOW-406). */
  href?: string;
  /** FLOW-406: a parent says how many sub-categories it has, with a chevron. */
  subCount?: number;
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
      chevron={subCount != null}
      meta={subCount != null
        ? subCount === 0 ? "תת-קטגוריות מוסתרות" : subCount === 1 ? "תת-קטגוריה אחת" : `${String(subCount)} תת-קטגוריות`
        : lineCount(category) == null ? undefined : countLine(lineCount(category) ?? 0)}
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
  parentId: parentProp,
  listPath = "/settings/categories",
}: {
  sample?: ListedCategory[];
  /** Stories open the hidden list without a click. */
  hiddenOpen?: boolean;
  /** FLOW-406: the parent whose sub-categories this page lists (mockup cat-b-2). The route gives it. */
  parentId?: string;
  /** Where the list lives; the e2e fixture route has its own. */
  listPath?: string;
} = {}) {
  const routeParams = useParams();
  const parentId = parentProp ?? routeParams.parentId;
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const [params, setParams] = useSearchParams();
  const blocked = useBlockedPreview();
  const holdWrites = useHoldWrites();
  // FLOW-507: the role can turn viewer while a sheet is open, so each write checks it again.
  const writeBlocked = () => holdWrites || blocked();
  const categories = useCategoriesQuery(sample == null);
  const dashboard = useDashboardQuery(sample == null && preview === "off");
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, categories);
  const rows: ListedCategory[] = sample ?? categories.data ?? [];
  // FLOW-406: only a top-level, non-loan category has a page of sub-categories.
  const parentRow = parentId == null ? undefined : rows.find((row) => row.id === parentId);
  const parent = parentRow != null && parentRow.parent_id == null && parentRow.loan_part == null ? parentRow : null;
  // The kind lives in the URL, so Back from an income parent lands on הכנסות again.
  const kindPick = params.get("kind") === "income" ? "income" : "expense";
  const setKind = (next: "expense" | "income") => {
    setParams((current) => {
      const out = new URLSearchParams(current);
      if (next === "income") out.set("kind", "income");
      else out.delete("kind");
      return out;
    }, { replace: true });
  };
  const kind = parent?.kind ?? kindPick;
  const listHref = (listKind: "expense" | "income") => {
    const query = new URLSearchParams(search);
    if (listKind === "income") query.set("kind", "income");
    const text = query.toString();
    return `${listPath}${text === "" ? "" : `?${text}`}`;
  };
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
      assertNoError(await supabase.rpc("create_category", parent == null
        ? { p_name: categoryName, p_kind: kind }
        : { p_name: categoryName, p_kind: kind, p_parent_id: parent.id }));
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
  // FLOW-406: the top level, or one parent's sub-categories.
  const scope = parent == null ? topLevelCategories(rows) : rows.filter((row) => row.parent_id === parent.id);
  // A parent counts its visible sub-categories; one with only hidden ones still opens.
  const subCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.parent_id != null) subCounts.set(row.parent_id, (subCounts.get(row.parent_id) ?? 0) + (row.hidden ? 0 : 1));
  }
  const subCountOf = (category: ListedCategory) => (parent == null ? subCounts.get(category.id) : undefined);
  const rowHref = (category: ListedCategory) => (subCountOf(category) != null
    ? `${listPath}/${encodeURIComponent(category.id)}${search}`
    : linesHref(category));
  const shown = scope.filter((category) => category.kind === kind && !category.hidden);
  const hiddenRows = scope.filter((category) => category.kind === kind && category.hidden);
  const hiddenExpanded = showHidden && hiddenRows.length > 0;
  const anyKeptOut = scope.some((category) => category.kind === kind && category.excluded_from_pnl === true);
  // Follow the refetched row, so the rehab switch shows the saved value while the sheet stays open.
  const menuRow = menu ? rows.find((row) => row.id === menu.id) ?? menu : null;
  const menuLoanLine = menuRow ? loanCategoryLine(menuRow) : null;
  const previewNoCompany = sample == null && params.get("preview") === "empty";
  const liveNoCompany = sample == null && preview === "off" && dashboard.isSuccess && dashboard.data.company_id == null;
  if (previewNoCompany || liveNoCompany) {
    return <Navigate to={`/settings${search}`} replace />;
  }
  // A parent that is gone (deleted, or no longer a parent after a reload) goes back to the list.
  if (parentId != null && phase.kind === "ready" && parent == null) {
    return <Navigate to={`${listPath}${search}`} replace />;
  }
  const title = parent?.name ?? "קטגוריות";
  const kicker = parent == null ? "הגדרות" : "קטגוריות";
  const backTo = parent == null ? `/settings${search}` : listHref(parent.kind);
  const lines = parent?.rollup_lines ?? (parent == null ? undefined : lineCount(parent));
  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title={parentId == null ? "קטגוריות" : "קטגוריה"}
        kicker={parentId == null ? "הגדרות" : "קטגוריות"}
        backTo={parentId == null ? `/settings${search}` : `${listPath}${search}`}
        phase={phase}
        onRetry={() => { void categories.refetch(); }}
      />
    );
  }
  return (
    <div>
      <ScreenHeader title={title} kicker={kicker} backTo={backTo} subtitle={lines == null ? undefined : countLine(lines)} />
      {parent != null ? null : (
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
      )}
      {shown.length === 0 && hiddenRows.length === 0 && parent == null ? (
        <EmptyState icon={<TagIcon />} title="אין עדיין קטגוריות" body="קטגוריות נוצרות מהמסמכים של SUMIT או כשמוסיפים אחת" />
      ) : shown.length > 0 ? (
      <List className="ui-cat-list">
        {shown.map((category) => (
          <CategoryLine
            key={category.id}
            category={category}
            plain={holdWrites}
            href={rowHref(category)}
            subCount={subCountOf(category)}
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
          {parent == null ? "קטגוריה חדשה" : "הוספת תת-קטגוריה"}
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
        blocked={writeBlocked}
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
        title={parent == null ? "קטגוריה חדשה" : "תת-קטגוריה חדשה"}
        returnFocusRef={createOpener}
        action={
          <Button
            busy={createCategory.isPending}
            onClick={() => {
              if (writeBlocked()) return;
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
          if (writeBlocked()) return;
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
          if (writeBlocked()) return;
          merge.mutate();
        }}
      />
    </div>
  );
}
