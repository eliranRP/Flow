import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadScreens, screenLoaders } from "./screen-loaders";

// One loader type for the spies: the real ones each return their own module, a union too wide to spy on.
const loaders = screenLoaders as unknown as Record<string, () => Promise<unknown>>;

vi.mock("./ui/sheet", () => ({ loadSheetDrawer: () => Promise.resolve() }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preloadScreens", () => {
  it("fetches the screens a few at a time, in order, so a tapped screen is not queued behind all of them", async () => {
    let inFlight = 0;
    let most = 0;
    const order: string[] = [];
    for (const name of Object.keys(loaders)) {
      vi.spyOn(loaders, name).mockImplementation(async () => {
        order.push(name);
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return {};
      });
    }
    await preloadScreens(3);
    expect(most).toBe(3);
    expect(order).toEqual(Object.keys(screenLoaders));
  });

  it("goes on past a screen that fails to load", async () => {
    const names = Object.keys(loaders);
    const loaded: string[] = [];
    for (const name of names) {
      vi.spyOn(loaders, name).mockImplementation(() => {
        loaded.push(name);
        return name === names[0] ? Promise.reject(new Error("offline")) : Promise.resolve({});
      });
    }
    await preloadScreens(2);
    expect(loaded).toHaveLength(names.length);
  });
});
