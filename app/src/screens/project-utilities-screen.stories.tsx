import { useQueryClient } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Route, Routes } from "react-router-dom";
import { expect, userEvent, within } from "storybook/test";
import { ProjectUtilitiesScreen } from "./project-utilities-screen";
import { GEFEN, storyUtilityClient, useOfflineOnceRead, utilityPayersSample, utilityRefundsSample, utilityScheduleSample } from "./utility-refunds-sample";
import { StoryRoute } from "../ui/story-route";
import { ExampleBar } from "../ui/screen-stories-support";
import { UTILITY_PAYERS_KEY, UtilityClientProvider, type UtilityBill, type UtilityPayer } from "../utility-refunds";

const meta = {
  title: "Screens/ProjectUtilities",
  parameters: { flowRouter: false },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Puts the property's recurring expenses (הוספת ספק's choices) in the story's cache, under the key the real read uses. */
function SeedSchedule() {
  const client = useQueryClient();
  useState(() => {
    client.setQueryData(["recurring-schedule"], utilityScheduleSample());
    return true;
  });
  return null;
}

function GoOffline() {
  useOfflineOnceRead(UTILITY_PAYERS_KEY);
  return null;
}

/** The page at its route, reading through a stand-in for Flow's server (every change succeeds). */
function UtilitiesStory({ query = "", utilities = utilityPayersSample(), bills = utilityRefundsSample(), viewer = false, offline = false }: {
  query?: string;
  utilities?: UtilityPayer[];
  bills?: UtilityBill[];
  viewer?: boolean;
  offline?: boolean;
}) {
  return (
    <StoryRoute entry={`/projects/${GEFEN}/utilities${query}`} tabs viewer={viewer}>
      <UtilityClientProvider client={storyUtilityClient(bills, utilities)}>
        <SeedSchedule />
        {offline ? <GoOffline /> : null}
        <ExampleBar />
        <Routes>
          <Route path="/projects/:projectId/utilities" element={<ProjectUtilitiesScreen />} />
        </Routes>
      </UtilityClientProvider>
    </StoryRoute>
  );
}

/** FLOW-1135 (V3-Project-Utilities): each utility, its category and usual amount and who pays; two bills not refunded. */
export const ProjectUtilities: Story = {
  render: () => <UtilitiesStory />,
};

/** A viewer sees who pays each utility and changes nothing. */
export const ProjectUtilitiesViewer: Story = {
  name: "ProjectUtilities, viewer",
  render: () => <UtilitiesStory viewer />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("radiogroup", { name: "מי משלם: Power Co" });
    await expect(canvas.queryByRole("button", { name: /הוספת ספק/ })).toBeNull();
  },
};

/** No utility found yet: what Flow looks for, and הוספת ספק. */
export const ProjectUtilitiesEmpty: Story = {
  name: "ProjectUtilities, none yet",
  render: () => <UtilitiesStory utilities={[]} bills={[]} />,
};

/**
 * FLOW-1152: a long name wraps to two lines in its own direction, so at 320 each reads whole ("Power Co Regional
 * Utilities Authority"); below 374 the switch moves under the text when the name has no room. The category and the
 * usual amount wrap and are never cut; the switch keeps its size.
 */
export const ProjectUtilitiesLong: Story = {
  name: "ProjectUtilities, long content",
  render: () => (
    <UtilitiesStory
      utilities={utilityPayersSample().map((row) => ({
        ...row,
        supplier_name: `${row.supplier_name} Regional Utilities Authority`,
        category_name: `${String(row.category_name)} ושירותים משותפים לבניין`,
        usual_minor: row.usual_minor == null ? null : row.usual_minor * 100n + 37n,
      }))}
    />
  ),
};

/** FLOW-1154: offline, the band says from when the payers are shown. */
export const ProjectUtilitiesOffline: Story = {
  name: "ProjectUtilities, offline",
  render: () => <UtilitiesStory offline />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText(/אין חיבור · מוצג המצב/)).toBeInTheDocument();
  },
};

export const ProjectUtilitiesLoading: Story = {
  name: "ProjectUtilities, loading",
  render: () => <UtilitiesStory query="?preview=loading" />,
};

export const ProjectUtilitiesError: Story = {
  name: "ProjectUtilities, failed",
  render: () => <UtilitiesStory query="?preview=error" />,
};

/** חברה closes the utility's open bills and the toast offers ביטול. */
export const ProjectUtilitiesCompany: Story = {
  name: "ProjectUtilities, company pays",
  render: () => <UtilitiesStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole("link", { name: "2 לא הוחזרו" });
    const group = canvas.getByRole("radiogroup", { name: "מי משלם: Power Co" });
    await userEvent.click(within(group).getByRole("radio", { name: "חברה" }));
    await expect(await within(document.body).findByText("Power Co · החברה משלמת · 1 נסגרו")).toBeInTheDocument();
  },
};

/** הוספת ספק lists the property's recurring expenses that are not a utility yet. */
export const ProjectUtilitiesAdd: Story = {
  name: "ProjectUtilities, add a supplier",
  render: () => <UtilitiesStory />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /הוספת ספק/ }));
    await expect(await within(document.body).findByRole("button", { name: /Trash Co/ })).toBeInTheDocument();
  },
};
