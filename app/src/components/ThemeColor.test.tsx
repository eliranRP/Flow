// vitest-css: the status-bar colour is read from the tokens, so the token CSS must load.
// FLOW-372: the status-bar colour follows the chosen theme (data-theme), not only the OS.
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeColor } from "./ThemeColor";

let meta: HTMLMetaElement;

beforeEach(() => {
  meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = "#7B3FE4";
  document.head.append(meta);
});

afterEach(() => {
  meta.remove();
  document.documentElement.removeAttribute("data-theme");
  delete document.documentElement.dataset.band;
});

describe("ThemeColor", () => {
  it("follows the chosen theme on a non-band route: light, then dark, then back to system", async () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <ThemeColor />
      </MemoryRouter>,
    );

    document.documentElement.dataset.theme = "light";
    await waitFor(() => {
      expect(meta.content).toBe("#F6F4FA");
    });

    document.documentElement.dataset.theme = "dark";
    await waitFor(() => {
      expect(meta.content).toBe("#15111E");
    });

    document.documentElement.removeAttribute("data-theme");
    await waitFor(() => {
      expect(meta.content).toBe("#F6F4FA");
    });
    expect(meta.content).not.toBe("");
  });

  it("keeps the band colour on Home's failed load, where Home marks its band on (FLOW-958)", async () => {
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.band = "on";
    render(
      <MemoryRouter initialEntries={["/?preview=error-server"]}>
        <ThemeColor />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(meta.content).toBe(getComputedStyle(document.documentElement).getPropertyValue("--color-band").trim());
    });
    expect(meta.content).not.toBe("#F6F4FA");
  });

  it("uses the page background for a failing preview where no band is marked on", async () => {
    document.documentElement.dataset.theme = "light";
    render(
      <MemoryRouter initialEntries={["/projects/a?preview=error"]}>
        <ThemeColor />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(meta.content).toBe("#F6F4FA");
    });
  });
});
