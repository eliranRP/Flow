import { useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { addTriggerRef } from "../add-trigger";
import { documentProblem, type AttachedDocument, type EntryKind } from "../add-entry";
import { SAMPLE_ENTRY_FILLS } from "../add-entry-sample";
import { documentOf } from "../add-entry-doc";
import { quickNewPath, quickNewState } from "../open-from-query";
import { usePreviewSearch } from "../preview";
import { readSheetBackground } from "../sheet-background";
import { useDashboardQuery, useMercuryStatusQuery } from "../use-books";
import { useHoldOwnerSettings, useWriteGate } from "../use-is-viewer";
import { BankIcon, CameraIcon, CoinIcon, DocumentIcon, LoanIcon, ProjectsIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { RouteSheet } from "../ui/route-sheet";
import { AddEntrySheet } from "./add-entry-sheet";

export type AddBankState = "off" | "active" | "reconnect" | "unknown";

/** The bank row's state from the Mercury status read; a read still loading or failed shows the plain row. */
export function addBankState(status: { isLoading: boolean; isError: boolean; data?: { connected: boolean; last_error: string | null } }): AddBankState {
  if (status.isLoading || status.data == null) return "unknown";
  if (status.data.last_error === "auth") return "reconnect";
  return status.data.connected ? "active" : "off";
}

/** What the + sheet opens next: a form for a receipt (a photo or a file) or a cash/cheque line. */
interface OpenEntry {
  kind: EntryKind;
  document: AttachedDocument | null;
}

/**
 * The + tab (FLOW-331, FLOW-369): three tiles (receipt photo, file, cash or cheque), then the rows.
 * Each one replaces the /add entry, so Back from the screen it opens does not reopen this sheet.
 * Opened from a project (?project=), the title names it and the new-project row is not offered.
 */
export function AddForm({ bank }: { bank?: AddBankState } = {}) {
  const search = usePreviewSearch();
  const projectId = new URLSearchParams(search).get("project");
  // The project's name is read only when the sheet opens from one (the books query needs its provider).
  if (projectId == null) return <AddSheet bank={bank} fromProject={null} />;
  return <AddSheetFromProject bank={bank} projectId={projectId} />;
}

function AddSheetFromProject({ bank, projectId }: { bank?: AddBankState; projectId: string }) {
  const dashboard = useDashboardQuery();
  const project = dashboard.data?.projects.find((p) => p.id === projectId);
  return <AddSheet bank={bank} fromProject={project == null ? null : { id: project.id, name: project.name }} />;
}

function AddSheet({ bank: sampleBank, fromProject }: { bank?: AddBankState; fromProject: { id: string; name: string } | null }) {
  const search = usePreviewSearch();
  const mercury = useMercuryStatusQuery(sampleBank == null);
  const bank = sampleBank ?? addBankState(mercury);
  const navigate = useNavigate();
  const over = readSheetBackground(useLocation().state)?.pathname;
  const writeGate = useWriteGate("/");
  // FLOW-601: an editor adds projects and loans; connecting a bank is the owner's.
  const ownerOnlyHeld = useHoldOwnerSettings();
  // FLOW-369: the preview's `?entry=` opens the form with the board's values (add-entry-sample.ts).
  const [params] = useSearchParams();
  const fillName = params.get("entry");
  const fill = fillName != null && fillName in SAMPLE_ENTRY_FILLS ? SAMPLE_ENTRY_FILLS[fillName] : null;
  const [entry, setEntry] = useState<OpenEntry | null>(() => (fill == null ? null : { kind: "cash", document: null }));
  const [pickError, setPickError] = useState<string | null>(null);
  const cameraPicker = useRef<HTMLInputElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  function go(to: string) {
    void navigate(to, { replace: true, state: quickNewState(over) });
  }
  function leave() {
    void navigate(`/${search}`, { replace: true });
  }
  async function pickReceipt(file: File | undefined) {
    if (file == null) return;
    const problem = documentProblem(file);
    if (problem != null) {
      setPickError(problem === "size" ? "הקובץ גדול מדי (עד 25 MB)." : "אפשר לצרף PDF או תמונה.");
      return;
    }
    setPickError(null);
    setEntry({ kind: "receipt", document: await documentOf(file) });
  }
  // The two file inputs: the camera's shutter and the file tile's. Both hand their file to pickReceipt.
  const inputs = (
    <>
      <input
        ref={cameraPicker}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => { void pickReceipt(event.target.files?.[0]); event.target.value = ""; }}
      />
      <input
        ref={filePicker}
        type="file"
        accept="image/*,application/pdf"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => { void pickReceipt(event.target.files?.[0]); event.target.value = ""; }}
      />
    </>
  );
  if (entry != null) {
    return (
      <AddEntrySheet
        kind={entry.kind}
        initialDocument={entry.document}
        fromProjectId={fromProject?.id ?? null}
        fill={fill}
        onDone={leave}
        onClose={leave}
      />
    );
  }
  return (
    <RouteSheet
      title={fromProject == null ? "הוספה" : `הוספה ל־${fromProject.name}`}
      closeTo={`/${search}`}
      returnFocusRef={addTriggerRef}
    >
      <div>
        <div className="ui-add-tiles">
          <button type="button" className="ui-add-tile" onClick={() => { cameraPicker.current?.click(); }}>
            <span className="ui-add-tile-icon"><CameraIcon /></span>
            <span className="ui-add-tile-name">צילום קבלה</span>
            <span className="ui-add-tile-sub">או חשבונית</span>
          </button>
          <button type="button" className="ui-add-tile" onClick={() => { filePicker.current?.click(); }}>
            <span className="ui-add-tile-icon"><DocumentIcon /></span>
            <span className="ui-add-tile-name">קובץ</span>
            <span className="ui-add-tile-sub">PDF או תמונה</span>
          </button>
          <button type="button" className="ui-add-tile" onClick={() => { setEntry({ kind: "cash", document: null }); }}>
            <span className="ui-add-tile-icon"><CoinIcon /></span>
            <span className="ui-add-tile-name">מזומן או צ׳ק</span>
            <span className="ui-add-tile-sub">בלי מסמך</span>
          </button>
        </div>
        {pickError == null ? null : <p role="alert" className="ui-add-error">{pickError}</p>}
        {fromProject == null ? null : <p className="ui-add-scope">כל מה שתוסיפו ישויך לפרויקט הזה</p>}
        <div className="ui-add-rows">
          {fromProject == null ? (
            <ListRow
              variant="button"
              title="פרויקט חדש"
              icon={<ProjectsIcon />}
              chevron
              onClick={() => { go(quickNewPath("/projects", search, "project")); }}
            />
          ) : null}
          <ListRow
            variant="button"
            title="הלוואה חדשה"
            icon={<LoanIcon />}
            chevron
            onClick={() => { go(quickNewPath("/settings/loans", search, "loan")); }}
          />
          {ownerOnlyHeld ? null : (
          <ListRow
            variant="button"
            title="חיבור בנק"
            icon={<BankIcon />}
            hint={bank === "active" ? "מחובר" : bank === "reconnect" ? "צריך לחבר מחדש" : undefined}
            tone={bank === "reconnect" ? "warning" : undefined}
            chevron
            onClick={() => {
              const params = new URLSearchParams(search);
              // Connected: the connections page. Otherwise its Mercury sheet opens to connect.
              if (bank !== "active") params.set("sheet", "mercury");
              const query = params.toString();
              go(`/settings/connections${query === "" ? "" : `?${query}`}`);
            }}
          />
          )}
        </div>
      </div>
      {inputs}
    </RouteSheet>
  );
}
