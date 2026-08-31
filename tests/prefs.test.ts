import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadPrefs,
  savePrefs,
  loadHiddenCategories,
  saveHiddenCategories,
  DEFAULT_PREFS,
} from "../src/prefs.js";

// A stand-in for chrome.storage.local: an object, and the two methods prefs.ts uses.
let store: Record<string, unknown> = {};

beforeEach(() => {
  store = {};
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: store[key] } : {}),
        set: async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        },
      },
    },
  });
});

const stored = () => store["prefs"] as Record<string, unknown>;

describe("display preferences", () => {
  it("starts at the defaults with nothing stored", async () => {
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("round-trips a change", async () => {
    await savePrefs({ sortBySize: true });

    expect(await loadPrefs()).toEqual({ sortBySize: true, hideEmpty: true });
  });

  it("changes one preference without disturbing the other", async () => {
    await savePrefs({ sortBySize: true });
    await savePrefs({ hideEmpty: false });

    expect(await loadPrefs()).toEqual({ sortBySize: true, hideEmpty: false });
  });

  it("treats a missing or malformed value as the default", async () => {
    store["prefs"] = { sortBySize: "yes please", hiddenByPath: "nonsense" };

    // hideEmpty defaults to true, so only an explicit false turns it off
    expect(await loadPrefs()).toEqual({ sortBySize: false, hideEmpty: true });
    expect(await loadHiddenCategories("/o/r/pull/1")).toEqual([]);
  });
});

describe("remembering a filter per page", () => {
  it("gives back what was hidden on that page, and nothing for another", async () => {
    await saveHiddenCategories("/o/r/pull/1", ["Tests", "Docs"]);

    expect(await loadHiddenCategories("/o/r/pull/1")).toEqual(["Tests", "Docs"]);
    // A filter set on one PR says nothing about the next one
    expect(await loadHiddenCategories("/o/r/pull/2")).toEqual([]);
  });

  it("forgets a page once nothing is hidden there", async () => {
    await saveHiddenCategories("/o/r/pull/1", ["Tests"]);
    await saveHiddenCategories("/o/r/pull/1", []);

    expect(await loadHiddenCategories("/o/r/pull/1")).toEqual([]);
    expect(stored().hiddenByPath).toEqual({});
  });

  it("keeps the twenty most recent pages and drops the rest", async () => {
    for (let i = 1; i <= 25; i++) {
      await saveHiddenCategories(`/o/r/pull/${i}`, ["Tests"]);
    }

    const paths = Object.keys(stored().hiddenByPath as Record<string, string[]>);
    expect(paths).toHaveLength(20);
    expect(await loadHiddenCategories("/o/r/pull/1")).toEqual([]); // oldest, evicted
    expect(await loadHiddenCategories("/o/r/pull/25")).toEqual(["Tests"]);
  });

  it("counts a revisit as recent, so an active PR is not evicted", async () => {
    await saveHiddenCategories("/o/r/pull/1", ["Tests"]);
    for (let i = 2; i <= 20; i++) await saveHiddenCategories(`/o/r/pull/${i}`, ["Tests"]);

    // Touch the oldest again, then push one more page in
    await saveHiddenCategories("/o/r/pull/1", ["Docs"]);
    await saveHiddenCategories("/o/r/pull/21", ["Tests"]);

    expect(await loadHiddenCategories("/o/r/pull/1")).toEqual(["Docs"]);
    expect(await loadHiddenCategories("/o/r/pull/2")).toEqual([]); // now the oldest
  });

  it("does not disturb the display preferences", async () => {
    await savePrefs({ sortBySize: true });
    await saveHiddenCategories("/o/r/pull/1", ["Tests"]);

    expect(await loadPrefs()).toEqual({ sortBySize: true, hideEmpty: true });
  });
});

describe("concurrent saves", () => {
  // The content script fires these two independently and awaits neither: onPrefsChange when
  // the reader toggles sorting, onFilterChange when they click an eye. Both are a
  // read-modify-write of one storage key holding the whole prefs object, so run at the same
  // time they each read the old value and each write a full object — and whichever lands
  // second silently drops the other's change. Only visible after a reload.
  it("keeps both changes when a preference and a filter are saved together", async () => {
    const both = [savePrefs({ sortBySize: true }), saveHiddenCategories("/o/r/pull/1", ["Tests"])];
    await Promise.all(both);

    expect(await loadPrefs()).toEqual({ sortBySize: true, hideEmpty: true });
    expect(await loadHiddenCategories("/o/r/pull/1")).toEqual(["Tests"]);
  });

  it("keeps every change in a burst of saves", async () => {
    await Promise.all([
      savePrefs({ sortBySize: true }),
      savePrefs({ hideEmpty: false }),
      saveHiddenCategories("/o/r/pull/1", ["Tests"]),
      saveHiddenCategories("/o/r/pull/2", ["Docs"]),
    ]);

    expect(await loadPrefs()).toEqual({ sortBySize: true, hideEmpty: false });
    expect(await loadHiddenCategories("/o/r/pull/1")).toEqual(["Tests"]);
    expect(await loadHiddenCategories("/o/r/pull/2")).toEqual(["Docs"]);
  });

  // A failing write must not wedge the queue for the rest of the session.
  it("carries on after a write that throws", async () => {
    const local = (chrome as unknown as { storage: { local: { set: unknown } } }).storage.local;
    const realSet = local.set;
    local.set = async () => {
      throw new Error("quota");
    };
    await expect(savePrefs({ sortBySize: true })).rejects.toThrow("quota");
    local.set = realSet;

    await savePrefs({ hideEmpty: false });

    expect(await loadPrefs()).toEqual({ sortBySize: false, hideEmpty: false });
  });
});
