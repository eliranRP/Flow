import { afterEach, describe, expect, it, vi } from "vitest";
import { watchHomeReady } from "./splash-ready";

// FLOW-1303: what counts as "Home's first figures are drawn".
afterEach(() => {
  document.body.replaceChildren();
  window.history.pushState({}, "", "/");
});

function add(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

const flush = () =>
  new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });

describe("watchHomeReady", () => {
  it("is ready at once on a route other than Home (the login screen)", () => {
    window.history.pushState({}, "", "/sign-in");
    const ready = vi.fn();
    watchHomeReady(ready);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("is ready at once when the figures are already there and nothing is loading", () => {
    add('<div class="ui-band-body"><span class="ui-num">5</span></div>');
    const ready = vi.fn();
    watchHomeReady(ready);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("is not ready on Home with nothing drawn, or with figures outside the band", async () => {
    add('<span class="ui-num">5</span>');
    const ready = vi.fn();
    const stop = watchHomeReady(ready);
    await flush();
    expect(ready).not.toHaveBeenCalled();
    stop();
  });

  it.each([".ui-skeleton-bar", ".ui-skel-row", ".ui-skel-leaving", '[aria-busy="true"]'])("is not ready while %s is on the page", async (selector) => {
    add('<div class="ui-band-body"><span class="ui-num">5</span></div>');
    const busy = add("<i></i>").firstElementChild as HTMLElement;
    if (selector.startsWith("[")) busy.setAttribute("aria-busy", "true");
    else busy.className = selector.slice(1);
    const ready = vi.fn();
    const stop = watchHomeReady(ready);
    expect(ready).not.toHaveBeenCalled();
    busy.remove();
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);
    stop();
  });

  it("notices a busy mark clearing without any node coming or going", async () => {
    add('<div class="ui-band-body" aria-busy="true"><span class="ui-num">5</span></div>');
    const ready = vi.fn();
    watchHomeReady(ready);
    document.querySelector(".ui-band-body")?.setAttribute("aria-busy", "false");
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("is ready when an error state is up", async () => {
    const ready = vi.fn();
    watchHomeReady(ready);
    add('<section class="ui-card ui-page-failed" role="alert"></section>');
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("calls back once, and a stop before it fires keeps it from firing", async () => {
    const ready = vi.fn();
    watchHomeReady(ready);
    add('<div class="ui-band-body"><span class="ui-num">1</span></div>');
    await flush();
    add('<div class="ui-band-body"><span class="ui-num">2</span></div>');
    await flush();
    expect(ready).toHaveBeenCalledTimes(1);

    document.body.replaceChildren();
    const late = vi.fn();
    watchHomeReady(late)();
    add('<div class="ui-band-body"><span class="ui-num">3</span></div>');
    await flush();
    expect(late).not.toHaveBeenCalled();
  });

  it("takes the path from its probe (stories)", () => {
    const ready = vi.fn();
    watchHomeReady(ready, { path: () => "/" });
    expect(ready).not.toHaveBeenCalled();
    watchHomeReady(ready, { path: () => "/sign-in" });
    expect(ready).toHaveBeenCalledTimes(1);
  });
});
