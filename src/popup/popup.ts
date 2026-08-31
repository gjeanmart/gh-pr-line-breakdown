import { buildBreakdown } from "../matcher.js";
import type { Category } from "../config.js";
import type { FileEntry } from "../matcher.js";
import { safeCssColor } from "../color.js";
import { escapeAttr, escapeHtml } from "../html.js";
import { summarize, toMarkdown } from "../summary.js";
import { parseGitHubUrl } from "../page.js";
import type { RateLimit } from "../github_api.js";

const content = document.getElementById("content")!;

// The same two icons the widget uses, so one surface does not teach a different vocabulary
// from the other.
const EYE_OPEN =
  `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">` +
  `<path d="M8 2c-1.981 0-3.671.992-4.933 2.078C1.797 5.169.88 6.423.43 7.1a1.98 1.98 0 0 0 0 1.8c.45.677 1.367 1.931 2.637 3.022C4.33 13.008 6.019 14 8 14c1.981 0 3.671-.992 4.933-2.078 1.27-1.091 2.187-2.345 2.637-3.022a1.98 1.98 0 0 0 0-1.8c-.45-.677-1.367-1.931-2.637-3.022C11.67 2.992 9.981 2 8 2ZM8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>`;
const EYE_SLASH =
  EYE_OPEN.replace("</svg>", "") +
  `<line x1="2.5" y1="2.5" x2="13.5" y2="13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

let tabId: number | undefined;
let hiddenCategories = new Set<string>();

const TRUNCATION_NOTE =
  "This PR has more files than the GitHub API returns (3,000 max), so these totals are partial.";
let hideEmpty = true;

function showMessage(text: string, loading = false): void {
  content.innerHTML = loading
    ? `<p class="message loading"><span class="spinner"></span>${escapeHtml(text)}</p>`
    : `<p class="message">${escapeHtml(text)}</p>`;
}

// Same rule as the widget: a warning, not a readout. The live number lives in the settings
// page, which asks GitHub for it directly.
const LOW_QUOTA = 15;

function renderQuota(rate: RateLimit | null | undefined, hasToken: boolean): string {
  if (!rate || rate.remaining > LOW_QUOTA) return "";

  const limit = rate.limit > 0 ? ` of ${rate.limit.toLocaleString()}` : "";
  const resets = rate.resetAt
    ? ` · resets ${new Date(rate.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "";
  const advice = !hasToken && rate.remaining <= 15 ? " · add a token to raise the limit" : "";
  const spent = rate.remaining === 0 ? " quota-line--out" : "";

  return `<div class="quota-line${spent}">API calls: ${rate.remaining.toLocaleString()}${limit} left this hour${resets}${advice}</div>`;
}

function renderBreakdown(
  files: FileEntry[],
  categories: Category[],
  truncated: boolean,
  rate?: RateLimit | null,
  hasToken = false
): void {
  const rerender = () => renderBreakdown(files, categories, truncated, rate, hasToken);
  const summary = summarize(buildBreakdown(files, categories), categories);

  const rows = summary.rows
    .map(({ category, stats, percent, fileLabel, isEmpty }) => `
      <div class="row${isEmpty ? " row--empty" : ""}">
        <div class="cat-info">
          <span class="cat-dot" style="background:${safeCssColor(category.color)}"></span>
          <div class="cat-label">
            <span class="cat-name">${escapeHtml(category.name)}</span>
            <span class="cat-files">${fileLabel}</span>
          </div>
          <button class="cat-toggle${hiddenCategories.has(category.name) ? " cat-toggle--hidden" : ""}"
                  data-cat="${escapeAttr(category.name)}"
                  title="${hiddenCategories.has(category.name) ? "Show" : "Hide"} ${escapeAttr(category.name)} files"
                  aria-pressed="${hiddenCategories.has(category.name)}"
          >${hiddenCategories.has(category.name) ? EYE_SLASH : EYE_OPEN}</button>
        </div>
        <span class="stat stat-added">+${stats.added.toLocaleString()}</span>
        <span class="stat stat-removed">\u2212${stats.removed.toLocaleString()}</span>
        <span class="pct">${percent}%</span>
      </div>`)
    .join("");

  const emptyToggle =
    summary.emptyCount > 0
      ? `<button class="toggle-empty">${hideEmpty ? `Show ${summary.emptyCount} empty` : "Hide empty"}</button>`
      : "";
  const footer = `<div class="rows-footer"><button class="copy-md">Copy markdown</button>${emptyToggle}</div>`;

  content.innerHTML = `
    <div class="breakdown-header">
      <span class="bh-lines">${summary.totalLines.toLocaleString()} lines</span>
      <span class="bh-sep">&middot;</span>
      <span class="bh-files"${truncated ? ` title="${escapeAttr(TRUNCATION_NOTE)}"` : ""}>${truncated ? "first " : ""}${summary.filesLabel}</span>
      <span class="bh-spacer"></span>
      <span class="bh-added">+${summary.totalAdded.toLocaleString()}</span>
      <span class="bh-removed">\u2212${summary.totalRemoved.toLocaleString()}</span>
    </div>
    <div class="rows${hideEmpty ? " hide-empty" : ""}">${rows}</div>
    ${footer}
    ${renderQuota(rate, hasToken)}`;

  const copyButton = content.querySelector<HTMLButtonElement>(".copy-md");
  copyButton?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(summary, { truncated }));
      copyButton.textContent = "Copied";
    } catch {
      copyButton.textContent = "Copy failed";
    }
    setTimeout(() => {
      copyButton.textContent = "Copy markdown";
    }, 1500);
  });

  // Filtering happens in the page, so the popup asks the content script to do it. Without a
  // tab we are on some other page entirely and there is nothing to filter.
  for (const button of Array.from(content.querySelectorAll<HTMLButtonElement>(".cat-toggle"))) {
    button.addEventListener("click", async () => {
      const name = button.dataset.cat!;
      const nowHidden = !hiddenCategories.has(name);
      if (tabId === undefined) return;

      try {
        await chrome.tabs.sendMessage(tabId, {
          type: "setCategoryVisible",
          category: name,
          visible: !nowHidden,
        });
      } catch {
        return; // the page went away; leave the popup showing what is actually true
      }

      if (nowHidden) hiddenCategories.add(name);
      else hiddenCategories.delete(name);
      rerender();
    });
  }

  content.querySelector(".toggle-empty")?.addEventListener("click", () => {
    hideEmpty = !hideEmpty;
    content.querySelector(".rows")?.classList.toggle("hide-empty", hideEmpty);
    const btn = content.querySelector<HTMLElement>(".toggle-empty");
    if (btn) {
      const n = content.querySelectorAll(".row--empty").length;
      btn.textContent = hideEmpty ? `Show ${n} empty` : "Hide empty";
    }
  });
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  tabId = tab?.id;

  const page = parseGitHubUrl(url);
  if (!page) {
    showMessage("Open a GitHub pull request or commit to see the line breakdown.");
    return;
  }

  showMessage("Loading\u2026", true);

  let response: {
    status: string;
    files?: FileEntry[];
    categories?: Category[];
    truncated?: boolean;
    rate?: RateLimit | null;
    hasToken?: boolean;
    hidden?: string[];
  };
  try {
    response = await chrome.tabs.sendMessage(tab.id!, { type: "getBreakdown" });
  } catch {
    showMessage("Could not reach the page — try reloading it.");
    return;
  }

  if (response.status === "loading") {
    showMessage("Loading changed files\u2026", true);
    return;
  }
  if (response.status === "error") {
    showMessage("Failed to load the changed files.");
    return;
  }

  hiddenCategories = new Set(response.hidden ?? []);
  renderBreakdown(
    response.files!,
    response.categories!,
    response.truncated === true,
    response.rate,
    response.hasToken === true
  );
}

document.getElementById("btn-options")!.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("footer-version")!.textContent =
  `v${chrome.runtime.getManifest().version}`;

init();
