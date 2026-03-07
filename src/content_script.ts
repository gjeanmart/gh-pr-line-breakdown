import { loadConfig } from "./config.js";
import { buildBreakdown } from "./matcher.js";
import { renderHeaderIcon, renderLoadingState } from "./widget.js";
import { fetchPrFilesFromApi } from "./github_api.js";
import type { Config } from "./config.js";
import type { FileEntry } from "./matcher.js";

let currentConfig: Config | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// API result cache — keyed by PR URL path, reset on navigation to a different PR
let cachedPrPath: string | null = null;
let cachedFiles: FileEntry[] | null = null;
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
    renderLoadingState();
    cachedFiles = await fetchPrFilesFromApi(currentConfig.githubToken);
  }

  if (!cachedFiles || cachedFiles.length === 0) return;

  const breakdown = buildBreakdown(cachedFiles, currentConfig.categories);
  renderHeaderIcon(breakdown, currentConfig.categories);
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

init();
