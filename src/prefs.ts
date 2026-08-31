// How the reader has set the breakdown up, remembered between page loads.
//
// Two kinds live here. The display preferences — sort order, whether empty categories show —
// are global: they are how you like to read a breakdown, not a fact about one PR. The hidden
// categories are per PR, because "I have dealt with the tests in this PR" says nothing about
// the next one, and having a filter follow you to an unrelated diff would be worse than not
// remembering at all.
//
// chrome.storage.local, not sync: this is per-device UI state, and syncing a filter for a PR
// your other machine has never opened is noise.

const KEY = "prefs";

/** How many PRs to remember filters for. Enough for a review session, not a database. */
const MAX_REMEMBERED_PRS = 20;

export type Prefs = {
  /** Read the breakdown biggest-first rather than in category order. */
  sortBySize: boolean;
  /** Categories with nothing in them stay collapsed behind the footer link. */
  hideEmpty: boolean;
};

export const DEFAULT_PREFS: Prefs = { sortBySize: false, hideEmpty: true };

type Stored = Prefs & {
  /** Page path → category names hidden there, most recent last. */
  hiddenByPath: Record<string, string[]>;
};

const EMPTY: Stored = { ...DEFAULT_PREFS, hiddenByPath: {} };

async function read(): Promise<Stored> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY] as Partial<Stored> | undefined;
  if (!value) return { ...EMPTY };

  return {
    sortBySize: value.sortBySize === true,
    hideEmpty: value.hideEmpty !== false,
    hiddenByPath: isPathMap(value.hiddenByPath) ? value.hiddenByPath : {},
  };
}

function isPathMap(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(
      (entry) => Array.isArray(entry) && entry.every((name) => typeof name === "string")
    )
  );
}

export async function loadPrefs(): Promise<Prefs> {
  const { sortBySize, hideEmpty } = await read();
  return { sortBySize, hideEmpty };
}

export async function savePrefs(update: Partial<Prefs>): Promise<void> {
  const current = await read();
  await chrome.storage.local.set({ [KEY]: { ...current, ...update } });
}

/** Which categories the reader hid on this page last time they were here. */
export async function loadHiddenCategories(path: string): Promise<string[]> {
  const { hiddenByPath } = await read();
  return hiddenByPath[path] ?? [];
}

export async function saveHiddenCategories(path: string, hidden: string[]): Promise<void> {
  const current = await read();
  const hiddenByPath = { ...current.hiddenByPath };

  // Re-insert at the end so this page counts as the most recently used
  delete hiddenByPath[path];
  if (hidden.length > 0) hiddenByPath[path] = [...hidden];

  const paths = Object.keys(hiddenByPath);
  for (const stale of paths.slice(0, Math.max(0, paths.length - MAX_REMEMBERED_PRS))) {
    delete hiddenByPath[stale];
  }

  await chrome.storage.local.set({ [KEY]: { ...current, hiddenByPath } });
}
