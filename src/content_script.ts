import { loadConfig } from "./config.js";
import { buildBreakdown, classifyFile } from "./matcher.js";
import { renderHeaderIcon, renderLoadingState, renderError, getHiddenCategories, resetCategoryFilter } from "./widget.js";
import { fetchFiles } from "./github_api.js";
import { parseGitHubPage } from "./page.js";
import { injectBadges, clearBadges, setFilesVisible } from "./badges.js";
import { injectTreeCounts, clearTreeCounts } from "./file_tree.js";
import type { Config, Category } from "./config.js";
import type { FileEntry } from "./matcher.js";

let currentConfig: Config | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// API result cache — keyed by PR or commit page path, reset on navigation
let cachedPath: string | null = null;
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

  const page = parseGitHubPage(window.location.pathname);
  if (!page) return;

  if (page.path !== cachedPath) {
    // New PR or commit — render the loading state, then fetch
    cachedPath = page.path;
    cachedFiles = null;
    cachedError = false;
    resetCategoryFilter();
    clearBadges();
    clearTreeCounts();
    renderLoadingState();
    const result = await fetchFiles(page, currentConfig.githubToken);
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

function observeChanges(): void {
  // Observe document.body so tab switches (any PR tab) always trigger re-renders.
  const observer = new MutationObserver(() => {
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
  sendResponse({ status: "ready", files: cachedFiles, categories: currentConfig.categories });
});

init();
