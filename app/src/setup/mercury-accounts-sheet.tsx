import { useSheetHistory } from "../ui/back";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { useMercuryStatusQuery } from "../use-books";
import { useMercuryAccounts } from "../use-mercury-accounts";
import { MercuryAccountsStep } from "../screens/mercury-accounts-step";

/**
 * Onboarding's step 3 of a Mercury connection (FLOW-938): after the key, the same accounts and date step
 * as Settings › Mercury, in a sheet over step 2. `slot` is the connection the key went to; null is closed.
 * Closing it before saving leaves the connection waiting, and Settings › Mercury opens on this step.
 */
export function MercuryAccountsSheet({ slot, onClose, onBack }: { slot: number | null; onClose: () => void; onBack: () => void }) {
  const open = slot != null;
  const setOpen = useSheetHistory("mercury-accounts", open, (next) => { if (!next) onClose(); });
  const status = useMercuryStatusQuery(open);
  const connection = status.data?.connections.find((candidate) => candidate.slot === slot);
  const save = useMercuryAccounts({ onSuccess: () => { setOpen(false); } });
  return (
    <Sheet open={open} onOpenChange={setOpen} title="חיבור Mercury" busy={save.isPending}>
      {connection == null ? (
        <List><ListRow variant="skeleton" /><ListRow variant="skeleton" /></List>
      ) : (
        <div className="ui-merc-sheet">
          <MercuryAccountsStep
            connection={connection}
            editing={false}
            busy={save.isPending}
            onSave={(pick) => { save.mutate({ slot: connection.slot, accounts: pick.accounts, from: pick.from, kind: "connect" }); }}
            onBack={() => { setOpen(false); onBack(); }}
          />
        </div>
      )}
    </Sheet>
  );
}
