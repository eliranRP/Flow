import "../ui/lazy.css";
import { type CategoryRow, formatAmountText } from "@flow/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { parseAmountMinor } from "../add-entry";
import { projectRows } from "../by-currency";
import { useCompanyCurrency } from "../company-currency";
import { shortMonth } from "../party-charges";
import { allTime } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useProjectForecastWrites } from "../project-forecast-writes";
import {
  type CategoryChoice,
  categoryChoices,
  currencyMark,
  draftOf,
  forecastCategoryIds,
  formatDraft,
  historyBars,
  historyDiff,
  monthWord,
  paceChoices,
  paceSummary,
  PACE_WORDS,
  savedToast,
} from "../project-next-edit";
import { type ForecastPace, LOAN_SOURCE, type NextMonthRow } from "../project-next-month";
import { useProjectNextMonth } from "../next-month-for-project";
import { screenPhase } from "../query-phase";
import { createCategoryNamed } from "../use-add-entry";
import { useProjectQuery } from "../use-books";
import { useWriteGate } from "../use-is-viewer";
import { useGoBack } from "../ui/back";
import { Button } from "../ui/button";
import { ChoiceSheet } from "../ui/choice-sheet";
import { formatDayMonth } from "../ui/date-math";
import { ForecastAmountField, ForecastBars } from "../ui/forecast-edit-parts";
import { IconRow } from "../ui/icon-row";
import { ProjectsIcon, RepeatIcon, TagIcon } from "../ui/icons";
import { ProfitSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { useToast } from "../ui/toast";
import { ForecastCategorySheet } from "./project-next-category-sheet";
import type { ProjectProfitSample } from "./project-profit-screen";

/** A story's, a test's or the dev route's page: the forecast's sample and the page's own starting state. */
export type ProjectNextEditSample = ProjectProfitSample & {
  next: NonNullable<ProjectProfitSample["next"]>;
  rowKey?: string;
  draft?: string;
  pace?: ForecastPace;
  categoryId?: string;
  sheet?: "category" | "pace";
  query?: string;
};

/** "נובמבר · הוצאה · ממוצע 6 חודשים", "נובמבר · הוצאה · לפי ההלוואה", "צפוי 01/11 · הכנסה · קבוע". */
function metaLine(row: NextMonthRow, income: boolean, month: string, averageMonths: number): string {
  const side = income ? "הכנסה" : "הוצאה";
  if (row.kind === "recurring" && row.date != null) return `צפוי ${formatDayMonth(row.date)} · ${side} · קבוע`;
  if (row.kind === "loan") return `${monthWord(month)} · ${side} · ${LOAN_SOURCE}`;
  if (row.kind === "added") return `${monthWord(month)} · ${side} · הוספת · ${row.pace == null || row.pace === "once" ? `רק ב${monthWord(month)}` : PACE_WORDS[row.pace]}`;
  return `${monthWord(month)} · ${side} · ${averageMonths === 1 ? "ממוצע חודש אחד" : `ממוצע ${String(averageMonths)} חודשים`}`;
}

/** The row's category name: an average's own, a charge's from the company's list, an added line's. */
function categoryName(row: NextMonthRow, categories: readonly CategoryRow[]): string {
  if (row.kind !== "recurring") return row.name;
  return categories.find((category) => category.id === row.categoryId)?.name ?? "בלי קטגוריה";
}

/** "+ יצירת קטגוריה": the app's create_category write (an expense category), then the list reads again. */
function useCreateForecastCategory() {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ name }: { name: string }) => createCategoryNamed(name, "expense"),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ["categories"] }); },
    onError: () => { toast.show({ tone: "bad", message: "לא הצלחנו ליצור את הקטגוריה" }); },
  });
}

/**
 * The ProfitNextEdit and ProfitNextAdd pages: one row of the project's next-month forecast, or a new line.
 * The amount (with its pencil), the project (fixed) and the category (a new line picks it in the sheet), how
 * often it applies (the pace sheet), the category's last five months in the project against the forecast,
 * then שמירה (or הוספה לצפי) and, for a row, הסרה מהצפי. A save or a removal goes back to the forecast with
 * a toast that can undo it.
 */
export function ProjectNextEditScreen({ add = false, sample }: { add?: boolean; sample?: ProjectNextEditSample } = {}) {
  const params = useParams();
  const projectId = sample?.project.id ?? params.projectId ?? "";
  const rowKey = sample?.rowKey ?? params.rowKey ?? "";
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const goBack = useGoBack();
  const backTo = `/projects/${projectId}/profit/next${search}`;
  const gate = useWriteGate(backTo);
  const companyCurrency = useCompanyCurrency();
  const detail = useProjectQuery(sample ? "" : projectId, allTime());
  const project = sample?.project ?? detail.data ?? null;
  const figures = project == null ? null : projectRows(project, companyCurrency)[0] ?? null;
  // FLOW-1002: the overhead project's page is the company's general costs, in the company's currency.
  const next = useProjectNextMonth(projectId, figures?.currency ?? companyCurrency, sample?.next, sample == null && figures != null);
  const currency = next.currency;
  const writes = useProjectForecastWrites(projectId, next.month);
  const create = useCreateForecastCategory();
  const [draftText, setDraftText] = useState<string | null>(sample?.draft == null ? null : formatDraft(sample.draft));
  const [pace, setPace] = useState<ForecastPace>(sample?.pace ?? "once");
  const [picked, setPicked] = useState<CategoryChoice | null>(null);
  const [sheet, setSheet] = useState<"category" | "pace" | null>(sample?.sheet ?? null);
  const [query, setQuery] = useState(sample?.query ?? "");
  const [missingAmount, setMissingAmount] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLButtonElement>(null);
  const paceRef = useRef<HTMLButtonElement>(null);

  const forecast = next.forecast;
  const month = next.month;
  const categories = next.categories;
  const row = add || forecast == null ? null : forecast.rows.find((item) => item.key === rowKey) ?? forecast.removed.find((item) => item.key === rowKey) ?? null;
  const choices = useMemo(() => categoryChoices({
    categories,
    categoryMonths: next.categoryMonths,
    recurring: next.recurring,
    projectId,
    currency,
    divisor: forecast?.averageMonths ?? 6,
    inForecast: forecast == null ? new Set() : forecastCategoryIds(forecast),
    query,
  }), [categories, next.categoryMonths, next.recurring, projectId, currency, forecast, query]);
  // The dev route's and a story's chosen category, from the same lists the sheet shows.
  const preset = sample?.categoryId == null
    ? null
    : [...choices.suggested, ...choices.rest].find((choice) => choice.id === sample.categoryId)
      ?? categories.filter((category) => category.id === sample.categoryId).map((category): CategoryChoice => ({ id: category.id, name: category.name, kind: category.kind, hint: "" }))[0]
      ?? null;
  const chosen = picked ?? preset;

  const phase = sample
    ? ({ kind: "ready" } as const)
    : screenPhase(preview, {
      isPending: detail.isPending || (figures != null && next.pending),
      isError: detail.isError || next.failed,
      isPaused: detail.isPaused || next.paused,
    });
  if (gate !== "show" && sample == null) return gate === "wait" ? null : gate;

  const income = add ? chosen?.kind === "income" : (row?.minor ?? 0n) > 0n;
  const draft = draftText ?? (row == null ? "" : draftOf(row.minor));
  const amount = parseAmountMinor(draft);
  const name = add ? chosen?.name ?? null : row?.name ?? "";
  const projectName = project?.name ?? "";
  const shownCategory = add ? chosen?.name ?? null : row == null ? "" : categoryName(row, categories);
  const historyCategory = add ? chosen?.id ?? null : row?.categoryId ?? null;
  const bars = add && chosen == null ? null : historyBars(next.categoryMonths, historyCategory, currency);
  const diff = bars == null ? null : historyDiff(amount == null ? null : BigInt(amount), bars.usual, currency, month);
  const summary = paceSummary(pace, month, income);
  const hint = add
    ? `השורה נכנסת לצפי של ${projectName} בלבד. לא נוצרת תנועה.`
    : row?.kind === "recurring"
      ? "הקבוע עצמו לא משתנה. זה משנה רק את הצפי של הפרויקט."
      : row?.kind === "loan"
        ? "ההלוואה עצמה לא משתנה. השינוי שלך גובר על לוח ההלוואה בצפי."
        : "Flow ממשיך ללמוד מהתנועות. השינוי שלך גובר על הממוצע.";

  function save() {
    if (add && chosen == null) {
      setSheet("category");
      return;
    }
    if (amount == null) {
      setMissingAmount(true);
      amountRef.current?.focus();
      return;
    }
    const back = { onSuccess: () => { goBack(backTo); } };
    if (add && chosen != null) {
      writes.mutate({ fn: "set_project_forecast_edit", edit: { category_id: chosen.id, amount_minor: amount, pace }, message: `נוסף לצפי: ${chosen.name}` }, back);
    } else if (row != null) {
      writes.mutate({ fn: "set_project_forecast_edit", edit: { row_key: row.key, amount_minor: amount, pace }, message: savedToast(pace, month, row.name) }, back);
    }
  }

  return (
    <ScreenState
      title={add ? "שורה חדשה בצפי" : name ?? ""}
      barOnly
      kicker={`צפי ${monthWord(month)}`}
      backTo={backTo}
      phase={phase.kind === "ready" && !add && forecast != null && row == null ? { kind: "empty" } : phase}
      empty={<p className="ui-page-pad t-caption t-muted">השורה הזו כבר לא בצפי.</p>}
      onRetry={() => { void detail.refetch(); next.refetch(); }}
      loading={<ProfitSkeleton />}
    >
      <div className="ui-fe-page">
        <div className="ui-fe-head">
          <span className="ui-fe-pill">{add ? `חדש בצפי · ${monthWord(month)}` : `צפי · ${monthWord(month)}`}</span>
          <h1 className="ui-fe-title">{add ? name ?? "שורה חדשה בצפי" : name}</h1>
          <ForecastAmountField
            value={draft}
            onChange={(text) => { setDraftText(formatDraft(text)); setMissingAmount(false); }}
            mark={currencyMark(currency)}
            sign={income ? "+" : "−"}
            income={income}
            label="סכום צפוי"
            inputRef={amountRef}
          />
          {missingAmount ? <p className="ui-fe-error" role="alert">כתבו סכום</p> : null}
          <span className="ui-fe-meta">
            {add || row == null ? `${monthWord(month)} · ${income ? "הכנסה" : "הוצאה"} · נוסף על ידך` : metaLine(row, income, month, forecast?.averageMonths ?? 6)}
          </span>
        </div>
        <div className="ui-fe-card">
          <IconRow icon={<ProjectsIcon />} label="פרויקט" value={projectName} />
          {add ? (
            <IconRow
              icon={<TagIcon />}
              label="קטגוריה"
              value={shownCategory ?? "בחרו קטגוריה"}
              valueTone={shownCategory == null ? "accent" : undefined}
              buttonRef={categoryRef}
              onClick={() => { setQuery(""); setSheet("category"); }}
            />
          ) : (
            <IconRow icon={<TagIcon />} label="קטגוריה" value={shownCategory ?? ""} />
          )}
        </div>
        <section className="ui-fe-card" aria-label="כל כמה זמן">
          <IconRow
            titled
            icon={<RepeatIcon />}
            label={summary.title}
            value={summary.sub}
            name={`כל כמה זמן: ${PACE_WORDS[pace]}`}
            endTag={<span className="ui-fe-pace">{PACE_WORDS[pace]}</span>}
            buttonRef={paceRef}
            onClick={() => { setSheet("pace"); }}
          />
          {bars == null || diff == null ? (
            <p className="ui-fe-no-history">
              {add && chosen == null ? "בחרו קטגוריה כדי לראות את התנועות הקודמות שלה בפרויקט." : "אין תנועות בקטגוריה הזו בפרויקט ב־6 החודשים האחרונים."}
            </p>
          ) : (
            <div className="ui-fe-history">
              <h2 className="ui-fe-history-title">בפרויקט, 5 החודשים האחרונים</h2>
              <p className="ui-fe-history-line">
                {"בדרך כלל "}
                <bdi dir="ltr">{formatAmountText(bars.usual, currency)}</bdi>
                {" · "}
                <span className={diff.high ? "ui-fe-diff ui-fe-diff-high" : "ui-fe-diff"}>{diff.text}</span>
              </p>
              <ForecastBars
                months={bars.months.map((bar) => ({ key: bar.month, label: bar.label, minor: bar.minor }))}
                forecast={{ key: month, label: `${shortMonth(month)} · צפי`, minor: BigInt(amount ?? 0) }}
              />
            </div>
          )}
        </section>
        <p className="ui-fe-hint">{hint}</p>
        <div className="ui-fe-actions">
          <Button full busy={writes.pending} onClick={save}>{add ? "הוספה לצפי" : "שמירה"}</Button>
          {add || row == null ? null : (
            <Button
              variant="danger-link"
              disabled={writes.pending}
              onClick={() => {
                // Decision 0219: the row leaves at once; a failure puts it back on the list with the failure toast.
                writes.mutate({ fn: "remove_project_forecast_row", rowKey: row.key, message: `הוסר מהצפי: ${row.name}` });
                goBack(backTo);
              }}
            >
              הסרה מהצפי
            </Button>
          )}
        </div>
      </div>
      <ChoiceSheet
        copy={{ historyKey: "pn-pace", title: "כל כמה זמן", subtitle: `${name ?? "שורה חדשה"} · בצפי של ${projectName}`, choices: paceChoices(month) }}
        open={sheet === "pace"}
        onOpenChange={(open) => { setSheet(open ? "pace" : null); }}
        value={pace}
        saving={null}
        onPick={(choice, close) => { setPace(choice); close(); }}
        returnFocusRef={paceRef}
        panelClassName="ui-pace-sheet"
      />
      <ForecastCategorySheet
        open={sheet === "category"}
        onOpenChange={(open) => { setSheet(open ? "category" : null); }}
        detail={`בצפי של ${projectName} • ${monthWord(month)}`}
        query={query}
        onQuery={setQuery}
        choices={choices}
        selected={chosen?.id ?? null}
        onPick={(choice) => {
          setPicked(choice);
          setSheet(null);
          setQuery("");
          // A new line starts at the category's usual month in the project, when it has one.
          const usual = historyBars(next.categoryMonths, choice.id, currency)?.usual;
          if (draftText == null && usual != null) setDraftText(draftOf(usual));
        }}
        onCreate={(newName) => {
          create.mutate({ name: newName }, {
            onSuccess: (id) => {
              setPicked({ id, name: newName, kind: "expense", hint: "קטגוריה חדשה" });
              setSheet(null);
              setQuery("");
            },
          });
        }}
        creating={create.isPending}
        returnFocusRef={categoryRef}
      />
    </ScreenState>
  );
}
