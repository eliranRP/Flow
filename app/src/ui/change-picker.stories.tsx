import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Picker } from "./change-picker";
import type { ChangeChoice } from "./change-sheet-copy";

const projects: ChangeChoice[] = [
  { id: "p-1", name: "שיפוץ הרצל 12", code: "P-12", status: "active" },
  { id: "p-2", name: "וילה רעננה", status: "active" },
  { id: "p-3", name: "מחסן הנמל", status: "active" },
];

/** The review sheet's project picker: a flat list under the "פרויקטים פעילים" heading (the heading hides while searching). */
function FlatWithHeading({ selectedId }: { selectedId: string }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(selectedId);
  return (
    <Picker
      kind="project"
      heading="פרויקטים פעילים"
      searchable
      query={query}
      onQuery={setQuery}
      loading={false}
      listed={projects.filter((p) => p.name.includes(query))}
      selectedId={selected}
      suggestionId=""
      savingId={null}
      onSelect={setSelected}
    />
  );
}

const meta = {
  title: "Components/Picker",
  component: Picker,
} satisfies Meta<typeof Picker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FlatWithHeadingSelected: Story = {
  args: { kind: "project", searchable: true, query: "", onQuery: () => undefined, loading: false, listed: projects, selectedId: "p-1", suggestionId: "", savingId: null, onSelect: () => undefined },
  render: () => <FlatWithHeading selectedId="p-1" />,
};
