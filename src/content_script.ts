import { loadConfig } from "./config.js";
import { buildBreakdown, classifyFile } from "./matcher.js";
import { renderHeaderIcon, renderLoadingState, renderError, getHiddenCategories, resetCategoryFilter } from "./widget.js";
import { fetchPrFilesFromApi } from "./github_api.js";
import { injectBadges, clearBadges, setFilesVisible } from "./badges.js";
import { injectTreeCounts, clearTreeCounts } from "./file_tree.js";
import type { Config, Category } from "./config.js";
import type { FileEntry } from "./matcher.js";

let currentConfig: Config | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// API result cache — keyed by PR URL path, reset on navigation to a different PR
let cachedPrPath: string | null = null;
let cachedFiles: FileEntry[] | null = null;
let cachedError: boolean = false;
let lastHref = location.href;

async function init(): Promise<void> {
  currentConfig = await loadConfig();
  await runBreakdown();
  observeChanges();
}

async function runBreakdown(): Promise<void> {
  if (!currentConfig) return;

  const prPath = getPrPath();
  if (!prPath) return;

  if (prPath !== cachedPrPath) {
    // New PR — show loading state immediately, then fetch
    cachedPrPath = prPath;
    cachedFiles = null;
    cachedError = false;
    resetCategoryFilter();
    clearBadges();
    clearTreeCounts();
    renderLoadingState();
    const result = await fetchPrFilesFromApi(currentConfig.githubToken);
    if (!result) return;
    if ("error" in result) {
      cachedError = true;
      renderError(result.error);
      return;
    }
    cachedFiles = result.files;
  }

  if (cachedError) return;
  if (!cachedFiles || cachedFiles.length === 0) return;

  const { categories } = currentConfig;
  const breakdown = buildBreakdown(cachedFiles, categories);
  const filesByCategory = buildFilesByCategory(cachedFiles, categories);

  renderHeaderIcon(breakdown, categories, (catName, visible) => {
    setFilesVisible(filesByCategory.get(catName) ?? [], visible);
  });

  await injectBadges(cachedFiles, categories);
  injectTreeCounts(cachedFiles);

  // Re-apply any active category filters to the freshly-injected DOM
  const hidden = getHiddenCategories();
  for (const [catName, filenames] of filesByCategory) {
    if (hidden.has(catName)) setFilesVisible(filenames, false);
  }
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

function getPrPath(): string | null {
  const match = window.location.pathname.match(/^\/[^/]+\/[^/]+\/pull\/\d+/);
  return match ? match[0] : null;
}

function observeChanges(): void {
  // Observe document.body so tab switches (any PR tab) always trigger re-renders.
  const observer = new MutationObserver(() => {
    // Detect SPA navigation to a different PR
    if (location.href !== lastHref) {
      lastHref = location.href;
      const newPrPath = getPrPath();
      if (newPrPath !== cachedPrPath) {
        cachedPrPath = null;
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
  if (!currentConfig || cachedPrPath === null) {
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
  sendResponse({ status: "ready", files: cachedFiles, categories: currentConfig.categories });
});

init();
