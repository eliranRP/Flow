import { useEffect, useRef, useState } from "react";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { useCompanyCurrencyQuery } from "../company-currency";
import { useDashboardQuery } from "../use-books";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { useHoldOwnerSettings, useHoldWrites, useViewerNoteId, ViewerNote, ViewerScope } from "../use-is-viewer";
import { basisChoiceLabel, BASIS_TITLE, currencyChoiceLabel, type BasisChoice } from "../ui/company-choices";
import { CalendarIcon, CoinIcon, BuildingIcon, SplitIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";
import { Toggle } from "../ui/toggle";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";
import { RenameCompanySheet } from "./rename-company";
import { useSheetHistory } from "../ui/back";
import { CompanyCurrencySheet } from "./company-currency-sheet";
import { CompanyBasisSheet } from "./company-basis-sheet";
import type { SettingsSample } from "./settings-screen";

const TITLE = "העסק";
const BACK = "/settings";
export const OVERHEAD_LABEL = "רווח אחרי הוצאות כלליות";
export const OVERHEAD_NOTE = "חלק מההוצאות הכלליות נכנס לרווח של כל פרויקט, לפי ההכנסות שלו.";
export const OVERHEAD_ON = "הוצאות כלליות מתחלקות בין הפרויקטים";
export const OVERHEAD_OFF = "הוצאות כלליות לא מתחלקות";
const OVERHEAD_FAILED = "לא הצלחנו לשמור את התצוגה.";

/**
 * `/settings/business` (FLOW-512): the business's name, currency and profit basis, then the
 * after-overhead switch. The owner changes them; anyone else reads the rows, with no chevron.
 */
export function BusinessScreen({ sample }: { sample?: SettingsSample } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const blocked = useBlockedPreview();
  const toast = useToast();
  const holdWrites = useHoldWrites();
  const holdOwner = useHoldOwnerSettings();
  const dashboard = useDashboardQuery(sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, dashboard);
  const live = sample == null && preview === "off";
  const liveCompany = live && dashboard.data?.company_id != null;
  const currencyQuery = useCompanyCurrencyQuery(liveCompany);
  const [renameOpen, setRenameOpen] = useState(false);
  // Browser Back closes the rename sheet and stays on this page.
  const setRenameSheet = useSheetHistory("business-rename", renameOpen, setRenameOpen);
  const renameRowRef = useRef<HTMLButtonElement>(null);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const currencyRowRef = useRef<HTMLButtonElement>(null);
  const [basisOpen, setBasisOpen] = useState(false);
  const basisRowRef = useRef<HTMLButtonElement>(null);
  const [overheadOn, setOverheadOn] = useState(false);
  const wantedOverhead = useRef(false);
  useEffect(() => {
    if (sample) return;
    if (dashboard.data) setOverheadOn(dashboard.data.after_overhead === true);
  }, [sample, dashboard.data]);

  const saveOverhead = useWrite({
    failure: OVERHEAD_FAILED,
    keys: ["dashboard", "project"],
    run: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("set_after_overhead", { p_on: wantedOverhead.current }));
    },
  });

  if (phase.kind === "loading" || phase.kind === "error") {
    return (
      <ScreenState
        title={TITLE}
        kicker="הגדרות"
        backTo={`${BACK}${search}`}
        phase={phase}
        onRetry={() => { void dashboard.refetch(); }}
        loading={(
          <List>
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
          </List>
        )}
      />
    );
  }

  const previewSample = sample == null && preview !== "off";
  const businessName = (sample ? sample.name : previewSample ? "בית הספר אלון" : dashboard.data?.name) ?? "";
  const namedBusiness = businessName.trim();
  const companyId = sample || previewSample ? null : (dashboard.data?.company_id ?? null);
  const currencyReady = !live || currencyQuery.isSuccess;
  const currencyFailed = live && currencyQuery.isError;
  const companyCurrency = live ? (currencyQuery.data ?? "ILS") : (sample?.loanCurrency ?? "ILS");
  const currencyHint = currencyChoiceLabel(companyCurrency);
  const companyBasis: BasisChoice = live ? (dashboard.data?.basis ?? "cash") : (sample?.basis ?? "cash");
  const basisHint = basisChoiceLabel(companyBasis);
  const showSheets = !holdOwner && namedBusiness !== "";
  const overheadLocked = holdWrites || holdOwner;

  // A saved change shows a toast with ביטול, which writes the previous value back (the board's).
  const setOverhead = (next: boolean, previous: boolean) => {
    if (sample) {
      setOverheadOn(next);
      return;
    }
    if (blocked()) return;
    setOverheadOn(next);
    wantedOverhead.current = next;
    saveOverhead.mutate(undefined, {
      onError: () => { setOverheadOn(previous); },
      onSuccess: () => {
        toast.show({
          message: next ? OVERHEAD_ON : OVERHEAD_OFF,
          action: "ביטול",
          onAction: () => { setOverhead(previous, next); },
        });
      },
    });
  };

  return (
    <ViewerScope>
    <div>
      <ScreenHeader title={TITLE} kicker="הגדרות" backTo={`${BACK}${search}`} />
      <ViewerNote />
      <List>
        {holdOwner ? (
          <ListRow variant="static" title="שם" value={namedBusiness} icon={<BuildingIcon />} />
        ) : (
          <ListRow
            variant="button"
            title="שם"
            value={namedBusiness}
            label={`שם העסק: ${namedBusiness}`}
            icon={<BuildingIcon />}
            chevron
            buttonRef={renameRowRef}
            onClick={() => { setRenameOpen(true); }}
          />
        )}
        {currencyReady && !holdOwner ? (
          <ListRow
            variant="button"
            title="מטבע"
            value={currencyHint}
            label={`מטבע העסק: ${currencyHint}`}
            icon={<CoinIcon />}
            chevron
            buttonRef={currencyRowRef}
            onClick={() => { setCurrencyOpen(true); }}
          />
        ) : (
          <ListRow
            variant="static"
            title="מטבע"
            value={currencyFailed ? "לא הצלחנו לטעון" : currencyHint}
            skelHint={!currencyReady && !currencyFailed}
            icon={<CoinIcon />}
          />
        )}
        {holdOwner ? (
          <ListRow variant="static" title={BASIS_TITLE} value={basisHint} icon={<CalendarIcon />} />
        ) : (
          <ListRow
            variant="button"
            title={BASIS_TITLE}
            value={basisHint}
            label={`${BASIS_TITLE}: ${basisHint}`}
            icon={<CalendarIcon />}
            chevron
            buttonRef={basisRowRef}
            onClick={() => { setBasisOpen(true); }}
          />
        )}
      </List>
      {showSheets && currencyReady ? (
        <CompanyCurrencySheet
          open={currencyOpen}
          onOpenChange={setCurrencyOpen}
          currency={companyCurrency}
          blocked={() => blocked(sample != null ? "empty" : undefined)}
          returnFocusRef={currencyRowRef}
        />
      ) : null}
      {showSheets ? (
        <CompanyBasisSheet
          open={basisOpen}
          onOpenChange={setBasisOpen}
          basis={companyBasis}
          blocked={() => blocked(sample != null ? "empty" : undefined)}
          returnFocusRef={basisRowRef}
        />
      ) : null}
      {showSheets ? (
        <RenameCompanySheet
          open={renameOpen}
          onOpenChange={setRenameSheet}
          companyId={companyId}
          currentName={namedBusiness}
          blocked={() => blocked(sample != null ? "empty" : undefined)}
          returnFocusRef={renameRowRef}
        />
      ) : null}
      <List>
        <Toggle
          label={OVERHEAD_LABEL}
          icon={<SplitIcon />}
          checked={overheadOn}
          locked={overheadLocked}
          disabledNoteId={useViewerNoteId() ?? undefined}
          onChange={(checked) => {
            if (overheadLocked) return;
            setOverhead(checked, overheadOn);
          }}
        />
      </List>
      <p className="ui-settings-note">{OVERHEAD_NOTE}</p>
    </div>
    </ViewerScope>
  );
}
