import { buildBreakdown } from "../matcher.js";
import type { Category } from "../config.js";
import type { FileEntry } from "../matcher.js";

const PR_PATTERN = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/;

const content = document.getElementById("content")!;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function showMessage(text: string, loading = false): void {
  content.innerHTML = loading
    ? `<p class="message loading"><span class="spinner"></span>${escapeHtml(text)}</p>`
    : `<p class="message">${escapeHtml(text)}</p>`;
}

function renderBreakdown(files: FileEntry[], categories: Category[]): void {
  const breakdown = buildBreakdown(files, categories);

  const grandTotal = categories.reduce((s, c) => s + (breakdown.get(c)?.total ?? 0), 0);
  const totalAdded = categories.reduce((s, c) => s + (breakdown.get(c)?.added ?? 0), 0);
  const totalRemoved = categories.reduce((s, c) => s + (breakdown.get(c)?.removed ?? 0), 0);
  const totalFiles = categories.reduce((s, c) => s + (breakdown.get(c)?.files ?? 0), 0);

  const rows = categories.map((cat) => {
    const stats = breakdown.get(cat)!;
    const pct = grandTotal > 0 ? Math.round((stats.total / grandTotal) * 100) : 0;
    const fileLabel = stats.files === 1 ? "1 file" : `${stats.files.toLocaleString()} files`;
    return `
      <div class="row">
        <div class="cat-info">
          <span class="cat-name">${escapeHtml(cat.name)}</span>
          <span class="cat-files">${fileLabel}</span>
        </div>
        <span class="stat stat-added">+${stats.added.toLocaleString()}</span>
        <span class="stat stat-removed">\u2212${stats.removed.toLocaleString()}</span>
        <span class="pct">${pct}%</span>
      </div>`;
  }).join("");

  const filesLabel = totalFiles === 1 ? "1 file" : `${totalFiles.toLocaleString()} files`;

  content.innerHTML = `
    <div class="breakdown-header">
      <span class="bh-lines">${grandTotal.toLocaleString()} lines</span>
      <span class="bh-sep">&middot;</span>
      <span class="bh-files">${filesLabel}</span>
      <span class="bh-spacer"></span>
      <span class="bh-added">+${totalAdded.toLocaleString()}</span>
      <span class="bh-removed">\u2212${totalRemoved.toLocaleString()}</span>
    </div>
    <div class="rows">${rows}</div>`;
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";

  if (!PR_PATTERN.test(url)) {
    showMessage("Navigate to a GitHub PR to see the line breakdown.");
    return;
  }

  showMessage("Loading\u2026", true);

  let response: { status: string; files?: FileEntry[]; categories?: Category[] };
  try {
    response = await chrome.tabs.sendMessage(tab.id!, { type: "getBreakdown" });
  } catch {
    showMessage("Could not reach the page — try reloading it.");
    return;
  }

  if (response.status === "loading") {
    showMessage("Loading PR data\u2026", true);
    return;
  }
  if (response.status === "error") {
    showMessage("Failed to load PR data.");
    return;
  }

  renderBreakdown(response.files!, response.categories!);
}

document.getElementById("btn-options")!.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById("footer-version")!.textContent =
  `v${chrome.runtime.getManifest().version}`;

init();
