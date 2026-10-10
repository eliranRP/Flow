import { screen, waitFor, type ByRoleMatcher } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Waits until the page shows an element with this role and name. Many screens draw one heading
 * (or sheet) while their reads load and another once they land, so an element found early can
 * leave the page before the next line checks it; this asks the page again on every try instead
 * of holding the first element found.
 */
export async function roleShows(role: ByRoleMatcher, name: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole(role, { name })).toBeInTheDocument();
  });
}
