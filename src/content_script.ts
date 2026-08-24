import { loadConfig } from "./config.js";
import { buildBreakdown, classifyFile } from "./matcher.js";
import {
  renderHeaderIcon,
  renderLoadingState,
  renderError,
  getHiddenCategories,
  resetCategoryFilter,
  type WidgetContext,
} from "./widget.js";
import { fetchFiles } from "./github_api.js";
import type { RateLimit } from "./github_api.js";
import { parseGitHubPage } from "./page.js";
import { injectBadges, clearBadges, setFilesVisible, restoreFilteredFiles } from "./badges.js";
import { injectTreeCounts, clearTreeCounts } from "./file_tree.js";
import type { Config, Category } from "./config.js";
import type { FileEntry } from "./matcher.js";

let currentConfig: Config | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let observer: MutationObserver | null = null;

// API result cache — keyed by PR or commit page path, reset on navigation
let cachedPath: string | null = null;
let cachedFiles: FileEntry[] | null = null;
let cachedError: boolean = false;
let cachedTruncated: boolean = false;
let cachedRate: RateLimit | null = null;
let lastHref = location.href;

async function init(): Promise<void> {
  currentConfig = await loadConfig();
  await runBreakdown();
  observeChanges();
  watchConfigChanges();
}

// Saving in the options page used to change nothing until every GitHub tab was reloaded,
// which reads as the extension being broken rather than as a stale cache.
function watchConfigChanges(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const categoriesChanged = area === "sync" && "config" in changes;
    const tokenChanged = area === "local" && "githubToken" in changes;
    if (!categoriesChanged && !tokenChanged) return;
    void applyNewConfig(tokenChanged);
  });
}

async function applyNewConfig(refetch: boolean): Promise<void> {
  currentConfig = await loadConfig();

  // Badges carry the old names and colours, and the filter refers to categories that may no
  // longer exist — so undo our collapses first, then start the page's annotations over.
  restoreFilteredFiles();
  resetCategoryFilter();
  clearBadges();
  clearTreeCounts();

  // A new token can unlock a repo that just failed, so that one needs the data again.
  if (refetch) {
    cachedPath = null;
    cachedFiles = null;
    cachedError = false;
  }

  await runBreakdown();
}

async function runBreakdown(): Promise<void> {
  if (!currentConfig) return;

  const page = parseGitHubPage(window.location.pathname);
  if (!page) return;

  if (page.path !== cachedPath) {
    // New PR or commit — render the loading state, then fetch
    cachedPath = page.path;
    cachedFiles = null;
    cachedError = false;
    cachedTruncated = false;
    resetCategoryFilter();
    clearBadges();
    clearTreeCounts();
    renderLoadingState(widgetContext());
    const result = await fetchFiles(page, currentConfig.githubToken);
    if (result.rate) cachedRate = result.rate;
    if ("error" in result) {
      cachedError = true;
      renderError(result.error, widgetContext());
      return;
    }
    cachedFiles = result.files;
    cachedTruncated = result.truncated === true;
  }

  if (cachedError) return;
  if (!cachedFiles || cachedFiles.length === 0) return;

  const { categories } = currentConfig;
  const breakdown = buildBreakdown(cachedFiles, categories);
  const filesByCategory = buildFilesByCategory(cachedFiles, categories);

  renderHeaderIcon(breakdown, categories, {
    ...widgetContext(),
    onToggleCategory: (catName, visible) => {
      setFilesVisible(filesByCategory.get(catName) ?? [], visible);
    },
  });

  const written = (await injectBadges(cachedFiles, categories)) + injectTreeCounts(cachedFiles);

  // Badges and tree counts are page mutations of our own making. Left queued they schedule
  // another full pass, which finds nothing to do and mutates nothing — so drop them here
  // and break the cycle. (Real GitHub mutations queued in the same window are dropped too;
  // its lazy rendering always follows up with more, so nothing stays missing for long.)
  if (written > 0) observer?.takeRecords();

  // Re-apply any active category filters to the freshly-injected DOM
  const hidden = getHiddenCategories();
  for (const [catName, filenames] of filesByCategory) {
    if (hidden.has(catName)) setFilesVisible(filenames, false);
  }
}

function widgetContext(): WidgetContext {
  return {
    truncated: cachedTruncated,
    rate: cachedRate,
    hasToken: Boolean(currentConfig?.githubToken),
    // openOptionsPage is not available to content scripts — the service worker answers this
    onOpenSettings: () => void chrome.runtime.sendMessage({ type: "openOptions" }),
  };
}

function buildFilesByCategory(files: FileEntry[], categories: Category[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const cat of categories) map.set(cat.name, []);
  for (const file of files) {
    const cat = classifyFile(file.filename, categories);
    map.get(cat.name)?.push(file.filename);
  }
  return map;
}

function observeChanges(): void {
  // Observe document.body so tab switches (any PR tab) always trigger re-renders.
  observer = new MutationObserver(() => {
    // Detect SPA navigation to a different PR or commit
    if (location.href !== lastHref) {
      lastHref = location.href;
      const newPath = parseGitHubPage(window.location.pathname)?.path ?? null;
      if (newPath !== cachedPath) {
        cachedPath = null;
        cachedFiles = null;
        cachedError = false;
      }
    }

    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      runBreakdown();
      debounceTimer = null;
    }, 300);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "getBreakdown") return;
  if (!currentConfig || cachedPath === null) {
    sendResponse({ status: "loading" });
    return;
  }
  if (cachedError) {
    sendResponse({ status: "error" });
    return;
  }
  if (!cachedFiles) {
    sendResponse({ status: "loading" });
    return;
  }
  sendResponse({
    status: "ready",
    files: cachedFiles,
    categories: currentConfig.categories,
    truncated: cachedTruncated,
  });
});

init();
