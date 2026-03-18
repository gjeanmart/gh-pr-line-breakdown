import type { Category } from "./config.js";
import type { CategoryStats } from "./matcher.js";
import type { ApiError } from "./github_api.js";

const HOST_ID = "gh-line-breakdown-host";

let currentAnchor: Element | null = null;
let shadowRoot: ShadowRoot | null = null;
let listenerController: AbortController | null = null;
let hideEmpty = true;
const hiddenCategories: Set<string> = new Set();

const EYE_OPEN = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 2c-1.981 0-3.671.992-4.933 2.078C1.797 5.169.88 6.423.43 7.1a1.98 1.98 0 0 0 0 1.8c.45.677 1.367 1.931 2.637 3.022C4.33 13.008 6.019 14 8 14c1.981 0 3.671-.992 4.933-2.078 1.27-1.091 2.187-2.345 2.637-3.022a1.98 1.98 0 0 0 0-1.8c-.45-.677-1.367-1.931-2.637-3.022C11.67 2.992 9.981 2 8 2ZM8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>`;
const EYE_SLASH = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 2c-1.981 0-3.671.992-4.933 2.078C1.797 5.169.88 6.423.43 7.1a1.98 1.98 0 0 0 0 1.8c.45.677 1.367 1.931 2.637 3.022C4.33 13.008 6.019 14 8 14c1.981 0 3.671-.992 4.933-2.078 1.27-1.091 2.187-2.345 2.637-3.022a1.98 1.98 0 0 0 0-1.8c-.45-.677-1.367-1.931-2.637-3.022C11.67 2.992 9.981 2 8 2ZM8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><line x1="2.5" y1="2.5" x2="13.5" y2="13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildRows(
  breakdown: Map<Category, CategoryStats>,
  categories: Category[]
): string {
  const grandTotal = categories.reduce((sum, cat) => sum + (breakdown.get(cat)?.total ?? 0), 0);
  const totalAdded = categories.reduce((sum, cat) => sum + (breakdown.get(cat)?.added ?? 0), 0);
  const totalRemoved = categories.reduce((sum, cat) => sum + (breakdown.get(cat)?.removed ?? 0), 0);
  const totalFiles = categories.reduce((sum, cat) => sum + (breakdown.get(cat)?.files ?? 0), 0);
  const scale = Math.max(totalAdded, totalRemoved, 1);

  const rows = categories
    .map((cat) => {
      const stats = breakdown.get(cat) ?? { added: 0, removed: 0, total: 0, files: 0 };
      const addedPct = (stats.added / scale) * 100;
      const removedPct = (stats.removed / scale) * 100;
      const pct = grandTotal > 0 ? Math.round((stats.total / grandTotal) * 100) : 0;
      const fileLabel = stats.files === 1 ? "1 file" : `${stats.files.toLocaleString()} files`;
      const emptyClass = stats.total === 0 ? " row--empty" : "";
      const isHidden = hiddenCategories.has(cat.name);
      const eyeIcon = isHidden ? EYE_SLASH : EYE_OPEN;
      const eyeTitle = isHidden ? "Show files" : "Hide files";
      const eyeClass = isHidden ? "cat-toggle cat-toggle--hidden" : "cat-toggle";
      return `
      <div class="row${emptyClass}">
        <span class="cat-name"><span class="cat-dot" style="background:${escapeHtml(cat.color ?? "#8c959f")}"></span>${escapeHtml(cat.name)}</span>
        <span class="cat-files">${fileLabel}</span>
        <div class="bar-track">
          <div class="bar-half bar-left">
            <div class="bar-fill bar-removed" style="width:${removedPct.toFixed(1)}%"></div>
          </div>
          <div class="bar-half bar-right">
            <div class="bar-fill bar-added" style="width:${addedPct.toFixed(1)}%"></div>
          </div>
        </div>
        <span class="stats"><span class="stat stat-added">+${stats.added.toLocaleString()}</span><span class="stat stat-removed">\u2212${stats.removed.toLocaleString()}</span></span>
        <span class="pct">${pct}%</span>
        <button class="${eyeClass}" data-cat="${escapeHtml(cat.name)}" title="${eyeTitle}" aria-label="${eyeTitle}">${eyeIcon}</button>
      </div>`;
    })
    .join("");

  const emptyCount = categories.filter(
    (cat) => (breakdown.get(cat)?.total ?? 0) === 0
  ).length;
  const footer =
    emptyCount > 0
      ? `<div class="footer"><button class="toggle-empty">${hideEmpty ? `Show ${emptyCount} empty` : "Hide empty"}</button></div>`
      : "";

  return `
    <div class="header">
      <span class="title"><svg class="title-icon" width="14" height="14" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="16" y="20" width="88" height="16" rx="4" fill="#0969da"/><rect x="16" y="44" width="72" height="16" rx="4" fill="#1f6feb"/><rect x="16" y="68" width="52" height="16" rx="4" fill="#388bfd"/><rect x="16" y="92" width="32" height="16" rx="4" fill="#79c0ff"/></svg>Line Breakdown</span>
      <span class="totals">
        <span class="total-lines">${grandTotal.toLocaleString()} lines</span>
        <span class="total-files">${totalFiles.toLocaleString()} ${totalFiles === 1 ? "file" : "files"}</span>
        <span class="total-added">+${totalAdded.toLocaleString()}</span>
        <span class="total-removed">\u2212${totalRemoved.toLocaleString()}</span>
      </span>
    </div>
    <div class="rows${hideEmpty ? " hide-empty" : ""}">${rows}</div>
    ${footer}
  `;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderLoadingState(): void {
  setContent(`<div class="loading"><span class="spinner"></span>Loading\u2026</div>`, true);
}

const ERROR_MESSAGES: Record<ApiError, string> = {
  rate_limit: "Rate limit reached \u2014 add a GitHub token in the options to increase your quota",
  not_accessible: "Repository not accessible \u2014 a GitHub token with repo scope may be required",
  auth_required: "Authentication required \u2014 add a GitHub token in the options",
  network: "Network error \u2014 check your connection and try again",
  unknown: "Failed to load PR data",
};

export function renderError(kind: ApiError): void {
  const msg = ERROR_MESSAGES[kind];
  setContent(`<div class="error"><span class="error-icon">&#9888;</span>${escapeHtml(msg)}</div>`, true);
}

export function renderHeaderIcon(
  breakdown: Map<Category, CategoryStats>,
  categories: Category[],
  onToggleCategory: (categoryName: string, visible: boolean) => void
): void {
  setContent(buildRows(breakdown, categories), false, onToggleCategory);
}

export function getHiddenCategories(): ReadonlySet<string> {
  return hiddenCategories;
}

export function resetCategoryFilter(): void {
  hiddenCategories.clear();
}

// ── Core render ───────────────────────────────────────────────────────────────

function setContent(
  html: string,
  autoShow: boolean,
  onToggleCategory?: (categoryName: string, visible: boolean) => void
): void {
  const anchor = findDiffstatAnchor();
  if (!anchor) return;

  (anchor as HTMLElement).style.cursor = "pointer";

  const shadow = ensureShadow();
  shadow.querySelector<HTMLElement>(".popup")!.innerHTML = html;

  shadow.querySelector(".toggle-empty")?.addEventListener("click", () => {
    hideEmpty = !hideEmpty;
    shadow.querySelector(".rows")?.classList.toggle("hide-empty", hideEmpty);
    const btn = shadow.querySelector<HTMLElement>(".toggle-empty");
    if (btn) {
      const n = shadow.querySelectorAll(".row--empty").length;
      btn.textContent = hideEmpty ? `Show ${n} empty` : "Hide empty";
    }
  });

  if (onToggleCategory) {
    for (const btn of Array.from(shadow.querySelectorAll<HTMLElement>(".cat-toggle"))) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const catName = btn.dataset.cat!;
        const nowHidden = !hiddenCategories.has(catName);
        if (nowHidden) {
          hiddenCategories.add(catName);
        } else {
          hiddenCategories.delete(catName);
        }
        onToggleCategory(catName, !nowHidden);
        btn.innerHTML = nowHidden ? EYE_SLASH : EYE_OPEN;
        btn.title = nowHidden ? "Show files" : "Hide files";
        btn.classList.toggle("cat-toggle--hidden", nowHidden);
      });
    }
  }

  const host = document.getElementById(HOST_ID) as HTMLElement;

  if (anchor !== currentAnchor) {
    currentAnchor = anchor;
    bindHoverListeners(host, anchor);
  }

  if (autoShow) {
    positionHost(host, anchor);
    host.style.display = "block";
  }
}

function positionHost(host: HTMLElement, anchor: Element): void {
  const rect = anchor.getBoundingClientRect();
  host.style.top = `${rect.bottom + window.scrollY + 8}px`;
  requestAnimationFrame(() => {
    host.style.left = `${rect.right + window.scrollX - host.offsetWidth}px`;
  });
}

function bindHoverListeners(host: HTMLElement, anchor: Element): void {
  listenerController?.abort();
  listenerController = new AbortController();
  const { signal } = listenerController;

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const show = () => {
    if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null; }
    positionHost(host, anchor);
    host.style.display = "block";
  };
  const scheduleHide = () => {
    hideTimer = setTimeout(() => { host.style.display = "none"; hideTimer = null; }, 120);
  };

  anchor.addEventListener("mouseenter", show, { signal });
  anchor.addEventListener("mouseleave", scheduleHide, { signal });
  host.addEventListener("mouseenter", show, { signal });
  host.addEventListener("mouseleave", scheduleHide, { signal });
}

function ensureShadow(): ShadowRoot {
  if (shadowRoot) return shadowRoot;

  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:absolute;z-index:2147483647;display:none;";
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<style>${STYLES}</style><div class="popup"></div>`;
  return shadowRoot;
}

// ── Anchor detection ──────────────────────────────────────────────────────────

function findDiffstatAnchor(): Element | null {
  const diffStates = document.querySelector('[class*="diffStatesWrap"]');
  if (diffStates) return diffStates;

  const tablist = document.querySelector('[role="tablist"]');
  if (!tablist) return null;

  let el: Element | null = tablist;
  for (let i = 0; i < 5; i++) {
    el = el?.parentElement ?? null;
    if (!el) break;
    const parent: HTMLElement | null = el.parentElement;
    if (!parent) break;
    for (const child of Array.from<Element>(parent.children)) {
      if (child !== el && child.querySelector(".fgColor-success, .color-fg-success")) {
        return child;
      }
    }
  }

  return null;
}

// ── Styles (Shadow DOM — fully isolated from GitHub's page styles) ────────────

const STYLES = `
  :host {
    all: initial;
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  }

  .popup {
    min-width: 480px;
    padding: 12px 16px 14px;
    background: #ffffff;
    border: 1px solid #d0d7de;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(31,35,40,0.12), 0 2px 6px rgba(31,35,40,0.06);
    font-size: 13px;
    color: #1f2328;
    white-space: nowrap;
    cursor: default;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid #eaeef2;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: #1f2328;
  }

  .title-icon {
    flex-shrink: 0;
  }

  .totals {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .total-lines  { color: #656d76; }
  .total-files  { color: #656d76; }
  .total-added  { color: #1a7f37; font-weight: 500; }
  .total-removed { color: #cf222e; font-weight: 500; }

  .cat-files {
    color: #656d76;
    font-weight: 400;
    font-size: 11px;
    white-space: nowrap;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .row {
    display: grid;
    grid-template-columns: 120px 56px 1fr auto 32px 20px;
    align-items: center;
    gap: 8px;
  }

  .stats {
    display: flex;
    gap: 8px;
  }

  .cat-name {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: #1f2328;
    white-space: nowrap;
    overflow: hidden;
  }

  .cat-dot {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .bar-track {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    height: 6px;
  }

  .bar-half {
    height: 6px;
    overflow: hidden;
    background: #eaeef2;
  }

  .bar-left  { display: flex; justify-content: flex-end;   border-radius: 3px 0 0 3px; }
  .bar-right { display: flex; justify-content: flex-start; border-radius: 0 3px 3px 0; }

  .bar-fill { height: 100%; transition: width 0.25s ease; }
  .bar-added   { background: #2da44e; }
  .bar-removed { background: #cf222e; }

  .stat {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    min-width: 48px;
  }

  .stat-added   { color: #1a7f37; }
  .stat-removed { color: #cf222e; }

  .pct {
    font-size: 11px;
    color: #656d76;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .rows.hide-empty .row--empty {
    display: none;
  }

  .cat-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: #8c959f;
    opacity: 0.5;
    border-radius: 3px;
    width: 20px;
    height: 20px;
    font-family: inherit;
    flex-shrink: 0;
  }

  .cat-toggle:hover {
    opacity: 1;
    background: #f6f8fa;
  }

  .cat-toggle--hidden {
    opacity: 1;
    color: #cf222e;
  }

  .cat-toggle--hidden:hover {
    background: #fff0f0;
  }

  .footer {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #eaeef2;
    text-align: right;
  }

  .toggle-empty {
    background: none;
    border: none;
    padding: 0;
    font-size: 11px;
    color: #0969da;
    cursor: pointer;
    font-family: inherit;
  }

  .toggle-empty:hover {
    text-decoration: underline;
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    color: #656d76;
    font-size: 13px;
  }

  .error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    color: #cf222e;
    font-size: 13px;
    max-width: 380px;
    white-space: normal;
    line-height: 1.4;
  }

  .error-icon {
    flex-shrink: 0;
    font-size: 14px;
  }

  .spinner {
    display: inline-block;
    width: 13px;
    height: 13px;
    border: 2px solid #d0d7de;
    border-top-color: #0969da;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
`;

// ── Utilities ─────────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
