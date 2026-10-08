import { useNavigate } from "react-router-dom";
import { addTriggerRef } from "../add-trigger";
import { quickNewPath } from "../open-from-query";
import { usePreviewSearch } from "../preview";
import { useMercuryStatusQuery } from "../use-books";
import { useWriteGate } from "../use-is-viewer";
import { useGoBack } from "../ui/back";
import { Button } from "../ui/button";
import { BankIcon, LoanIcon, ProjectsIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { RouteSheet } from "../ui/route-sheet";

export type AddBankState = "off" | "active" | "reconnect" | "unknown";

/** The bank row's state from the Mercury status read; a read still loading or failed shows the plain row. */
export function addBankState(status: { isLoading: boolean; isError: boolean; data?: { connected: boolean; last_error: string | null } }): AddBankState {
  if (status.isLoading || status.data == null) return "unknown";
  if (status.data.last_error === "auth") return "reconnect";
  return status.data.connected ? "active" : "off";
}

/**
 * The + tab (FLOW-331): quick actions that work today, until photo capture (FLOW-306) ships. Each
 * one replaces the /add entry, so Back from the screen it opens does not reopen this sheet.
 */
export function AddForm({ bank: sampleBank }: { bank?: AddBankState } = {}) {
  const search = usePreviewSearch();
  const mercury = useMercuryStatusQuery(sampleBank == null);
  const bank = sampleBank ?? addBankState(mercury);
  const goBack = useGoBack();
  const navigate = useNavigate();
  const writeGate = useWriteGate("/");
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  function go(to: string) {
    void navigate(to, { replace: true });
  }
  return (
    <RouteSheet
      title="הוספה"
      closeTo={`/${search}`}
      returnFocusRef={addTriggerRef}
    >
      <div className="ui-add-rows">
        <ListRow
          variant="button"
          title="פרויקט חדש"
          icon={<ProjectsIcon />}
          chevron
          onClick={() => { go(quickNewPath("/projects", search, "project")); }}
        />
        <ListRow
          variant="button"
          title="הלוואה חדשה"
          icon={<LoanIcon />}
          chevron
          onClick={() => { go(quickNewPath("/settings/loans", search, "loan")); }}
        />
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
      </div>
      <Button variant="ghost" full onClick={() => { goBack(`/${search}`); }}>ביטול</Button>
    </RouteSheet>
  );
}
