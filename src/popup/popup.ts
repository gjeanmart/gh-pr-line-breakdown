import { buildBreakdown } from "../matcher.js";
import type { Category } from "../config.js";
import type { FileEntry } from "../matcher.js";
import { safeCssColor } from "../color.js";
import { escapeAttr, escapeHtml } from "../html.js";
import { summarize, toMarkdown } from "../summary.js";
import { parseGitHubUrl } from "../page.js";

const content = document.getElementById("content")!;

const TRUNCATION_NOTE =
  "This PR has more files than the GitHub API returns (3,000 max), so these totals are partial.";
let hideEmpty = true;

function showMessage(text: string, loading = false): void {
  content.innerHTML = loading
    ? `<p class="message loading"><span class="spinner"></span>${escapeHtml(text)}</p>`
    : `<p class="message">${escapeHtml(text)}</p>`;
}

function renderBreakdown(files: FileEntry[], categories: Category[], truncated: boolean): void {
  const summary = summarize(buildBreakdown(files, categories), categories);

  const rows = summary.rows
    .map(({ category, stats, percent, fileLabel, isEmpty }) => `
      <div class="row${isEmpty ? " row--empty" : ""}">
        <div class="cat-info">
          <span class="cat-dot" style="background:${safeCssColor(category.color)}"></span>
          <div>
            <span class="cat-name">${escapeHtml(category.name)}</span>
            <span class="cat-files">${fileLabel}</span>
          </div>
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
    ${footer}`;

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

  const page = parseGitHubUrl(url);
  if (!page) {
    showMessage("Open a GitHub pull request or commit to see the line breakdown.");
    return;
  }

  showMessage("Loading\u2026", true);

  let response: { status: string; files?: FileEntry[]; categories?: Category[]; truncated?: boolean };
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

  renderBreakdown(response.files!, response.categories!, response.truncated === true);
}

document.getElementById("btn-options")!.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("footer-version")!.textContent =
  `v${chrome.runtime.getManifest().version}`;

init();
