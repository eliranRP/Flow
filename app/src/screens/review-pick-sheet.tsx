import { useMemo } from "react";
import { useHomePreview } from "../preview";
import { projectChoices } from "../project-groups";
import { useDashboardQuery } from "../use-books";
import { Picker } from "../ui/change-picker";
import type { ChangeChoice } from "../ui/change-sheet-copy";
import { Sheet } from "../ui/sheet";
import { Toggle } from "../ui/toggle";
import { reviewE2e } from "./review-shared";

// The review queue's project picker sheet, in its own file so review-queue.tsx stays under the size limit.

/** FLOW-960: the review picker shows its search from this many projects. */
const PICK_SEARCH_FROM = 10;

/**
 * FLOW-365: the project picker sheet over the card. It reads the books only while it is open. A pick
 * saves that one field (the caller) and the sheet closes; "לזכור לספק" is on by default.
 */
export function ProjectPickSheet({
  query,
  onQuery,
  selectedId,
  suggestionId,
  supplier,
  remember,
  onRemember,
  missing,
  onClose,
  onPick,
  onCreate,
}: {
  query: string;
  onQuery: (value: string) => void;
  selectedId: string;
  suggestionId: string;
  supplier: string;
  remember: boolean;
  onRemember: (value: boolean) => void;
  /** FLOW-960: אישור opened the sheet; one line says the pick comes first. */
  missing: boolean;
  onClose: () => void;
  onPick: (choice: ChangeChoice) => void;
  onCreate: () => void;
}) {
  const dashboard = useDashboardQuery(true);
  const samplePreview = useHomePreview() !== "off" && reviewE2e != null;
  const projectOptions = useMemo(
    () => (samplePreview && reviewE2e != null ? reviewE2e.e2eProjectChoices : projectChoices(dashboard.data)),
    [dashboard.data, samplePreview],
  );
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }} title="בחירת פרויקט" panelClassName="ui-review-pick">
      {missing ? <p className="ui-review-pick-missing">בוחרים פרויקט, ואז אפשר לאשר</p> : null}
      <Picker
        kind="project"
        heading="פרויקטים פעילים"
        // FLOW-960: a search earns its place from 10 projects; a short list is read at a glance.
        searchable={projectOptions.length >= PICK_SEARCH_FROM}
        query={query}
        onQuery={onQuery}
        loading={!samplePreview && dashboard.isPending}
        listed={projectOptions}
        selectedId={selectedId}
        suggestionId={suggestionId}
        savingId={null}
        onSelect={(id) => {
          const choice = projectOptions.find((option) => option.id === id);
          if (choice) onPick(choice);
        }}
        onCreate={onCreate}
        splitLink={false}
      />
      <Toggle label={`לזכור לספק ${supplier}`} checked={remember} onChange={onRemember} />
    </Sheet>
  );
}
