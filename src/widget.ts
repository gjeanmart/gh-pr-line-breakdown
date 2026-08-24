import type { Category } from "./config.js";
import type { CategoryStats } from "./matcher.js";
import type { ApiError, RateLimit } from "./github_api.js";
import { findDiffstatAnchor } from "./anchor.js";
import { safeCssColor } from "./color.js";
import { escapeAttr, escapeHtml } from "./html.js";
import { summarize, toMarkdown, type Summary } from "./summary.js";

const HOST_ID = "gh-line-breakdown-host";

let currentAnchor: Element | null = null;
let shadowRoot: ShadowRoot | null = null;
let listenerController: AbortController | null = null;
let hideEmpty = true;
let showErrorMarker = false;

/**
 * What the widget needs to know beyond the numbers themselves. Grew out of a parameter list
 * that had reached four and was still growing.
 */
export type WidgetContext = {
  /** The file list was capped by the API. */
  truncated?: boolean;
  /** What the API last said about our quota. */
  rate?: RateLimit | null;
  /** Whether a GitHub token is configured — decides whether quota is worth mentioning. */
  hasToken?: boolean;
  /** Opening the options page needs the extension APIs, which the content script owns. */
  onOpenSettings?: () => void;
  onToggleCategory?: (categoryName: string, visible: boolean) => void;
};

let context: WidgetContext = {};

// Pinned popups ignore mouseleave. Hover is right for opening; it is not right for reading
// nine rows, which is why this exists.
let pinned = false;
// Kept so the copy button can render markdown without recomputing the breakdown
let lastSummary: Summary | null = null;

// Unauthenticated calls are capped at 60 an hour and one large PR can cost 30, so the number
// only becomes interesting once it is low enough to matter. It is a warning here, not a
// readout — the settings page shows the number whenever anyone wants to look at it.
const LOW_QUOTA = 15;

// The errors a token can actually do something about
const TOKEN_FIXABLE: ApiError[] = ["rate_limit", "auth_required", "not_accessible"];
const hiddenCategories: Set<string> = new Set();

// A dot placed on GitHub's diffstat chip when the breakdown could not be loaded. The popup
// only opens on hover, so without this an API failure is completely silent.
const MARKER_CLASS = "gh-breakdown-alert";

// A pushpin: head and needle. Two primitives, so it cannot render as garbage the way
// hand-copied path data can, and the filled head reads as "on" at 13px.
const PIN_OUTLINE =
  `<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">` +
  `<circle cx="8" cy="5.6" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/>` +
  `<line x1="8" y1="9.4" x2="8" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const PIN_FILLED =
  `<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">` +
  `<circle cx="8" cy="5.6" r="3.4" fill="currentColor"/>` +
  `<line x1="8" y1="9.4" x2="8" y2="14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

const TITLE_ICON =
  `<svg class="title-icon" width="14" height="14" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
  `<rect x="16" y="20" width="88" height="16" rx="4" fill="#0969da"/>` +
  `<rect x="16" y="44" width="72" height="16" rx="4" fill="#1f6feb"/>` +
  `<rect x="16" y="68" width="52" height="16" rx="4" fill="#388bfd"/>` +
  `<rect x="16" y="92" width="32" height="16" rx="4" fill="#79c0ff"/></svg>`;

// Shown when the PR has more files than the API will return, so a partial total is never
// presented as if it were the whole PR.
const TRUNCATION_NOTE =
  "This PR has more files than the GitHub API returns (3,000 max), so these totals are partial.";

const QUOTA_NOTE =
  "Unauthenticated GitHub API calls are capped at 60 an hour. A token raises it to 5,000.";

const EYE_OPEN = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 2c-1.981 0-3.671.992-4.933 2.078C1.797 5.169.88 6.423.43 7.1a1.98 1.98 0 0 0 0 1.8c.45.677 1.367 1.931 2.637 3.022C4.33 13.008 6.019 14 8 14c1.981 0 3.671-.992 4.933-2.078 1.27-1.091 2.187-2.345 2.637-3.022a1.98 1.98 0 0 0 0-1.8c-.45-.677-1.367-1.931-2.637-3.022C11.67 2.992 9.981 2 8 2ZM8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/></svg>`;
const EYE_SLASH = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 2c-1.981 0-3.671.992-4.933 2.078C1.797 5.169.88 6.423.43 7.1a1.98 1.98 0 0 0 0 1.8c.45.677 1.367 1.931 2.637 3.022C4.33 13.008 6.019 14 8 14c1.981 0 3.671-.992 4.933-2.078 1.27-1.091 2.187-2.345 2.637-3.022a1.98 1.98 0 0 0 0-1.8c-.45-.677-1.367-1.931-2.637-3.022C11.67 2.992 9.981 2 8 2ZM8 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><line x1="2.5" y1="2.5" x2="13.5" y2="13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildRows(
  breakdown: Map<Category, CategoryStats>,
  categories: Category[]
): string {
  const truncated = context.truncated === true;
  const summary = summarize(breakdown, categories);

  const rows = summary.rows
    .map(({ category, stats, percent, fileLabel, isEmpty, addedWidth, removedWidth }) => {
      const isHidden = hiddenCategories.has(category.name);
      const eyeIcon = isHidden ? EYE_SLASH : EYE_OPEN;
      const eyeTitle = isHidden ? "Show files" : "Hide files";
      const eyeClass = isHidden ? "cat-toggle cat-toggle--hidden" : "cat-toggle";
      return `
      <div class="row${isEmpty ? " row--empty" : ""}">
        <span class="cat-name"><span class="cat-dot" style="background:${safeCssColor(category.color)}"></span>${escapeHtml(category.name)}</span>
        <span class="cat-files">${fileLabel}</span>
        <div class="bar-track">
          <div class="bar-half bar-left">
            <div class="bar-fill bar-removed" style="width:${removedWidth.toFixed(1)}%"></div>
          </div>
          <div class="bar-half bar-right">
            <div class="bar-fill bar-added" style="width:${addedWidth.toFixed(1)}%"></div>
          </div>
        </div>
        <span class="stats"><span class="stat stat-added">+${stats.added.toLocaleString()}</span><span class="stat stat-removed">\u2212${stats.removed.toLocaleString()}</span></span>
        <span class="pct">${percent}%</span>
        <button class="${eyeClass}" data-cat="${escapeAttr(category.name)}" title="${eyeTitle}" aria-label="${eyeTitle}">${eyeIcon}</button>
      </div>`;
    })
    .join("");

  lastSummary = summary;

  const emptyToggle =
    summary.emptyCount > 0
      ? `<button class="toggle-empty">${hideEmpty ? `Show ${summary.emptyCount} empty` : "Hide empty"}</button>`
      : "";
  const copyButton = `<button class="copy-md" title="Copy this breakdown as a markdown table">Copy markdown</button>`;
  const quota = buildQuotaHint();
  const footer = copyButton + emptyToggle + (quota ? `<span class="footer-gap"></span>${quota}` : "");

  return `
    <div class="header">
      <span class="title">${TITLE_ICON}Line Breakdown<button class="pin-toggle" aria-pressed="false"></button></span>
      <span class="totals">
        <span class="total-lines">${summary.totalLines.toLocaleString()} lines</span>
        <span class="total-files"${truncated ? ` title="${escapeAttr(TRUNCATION_NOTE)}"` : ""}>${truncated ? "first " : ""}${summary.filesLabel}</span>
        <span class="total-added">+${summary.totalAdded.toLocaleString()}</span>
        <span class="total-removed">\u2212${summary.totalRemoved.toLocaleString()}</span>
      </span>
    </div>
    <div class="rows${hideEmpty ? " hide-empty" : ""}">${rows}</div>
    ${footer ? `<div class="footer">${footer}</div>` : ""}
  `;
}

// Shown only when it is actionable: few enough calls left to become a problem shortly. Being
// down to 15 of 5,000 is worse news than 15 of 60, so having a token does not exempt you.
function buildQuotaHint(): string {
  const rate = context.rate;
  if (!rate || rate.remaining > LOW_QUOTA) return "";

  const label =
    rate.remaining === 0
      ? "No API calls left this hour"
      : `${rate.remaining} API call${rate.remaining === 1 ? "" : "s"} left this hour`;
  const suffix = rate.resetAt ? ` \u00b7 resets ${formatClockTime(rate.resetAt)}` : "";
  const advice = context.hasToken ? "" : " \u00b7 add a token";

  return `<button class="quota" title="${escapeAttr(QUOTA_NOTE)}">${label}${suffix}${advice}</button>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderLoadingState(ctx: WidgetContext = {}): void {
  context = ctx;
  showErrorMarker = false;
  setContent(`<div class="loading"><span class="spinner"></span>Loading\u2026</div>`);
}

const ERROR_MESSAGES: Record<ApiError, string> = {
  rate_limit: "Rate limit reached \u2014 add a GitHub token in the options to increase your quota",
  not_accessible: "Repository not accessible \u2014 a GitHub token with repo scope may be required",
  auth_required: "Authentication required \u2014 add a GitHub token in the options",
  network: "Network error \u2014 check your connection and try again",
  unknown: "Failed to load PR data",
};

export function renderError(kind: ApiError, ctx: WidgetContext = {}): void {
  context = ctx;
  showErrorMarker = true;

  const sentences = [ERROR_MESSAGES[kind]];
  if (kind === "rate_limit" && ctx.rate?.resetAt) {
    sentences.push(`Resets at ${formatClockTime(ctx.rate.resetAt)}.`);
  }

  const action =
    ctx.onOpenSettings && TOKEN_FIXABLE.includes(kind)
      ? `<div class="footer"><button class="settings-action">${ctx.hasToken ? "Check your token" : "Add a token"}</button></div>`
      : "";

  setContent(
    `<div class="error"><span class="error-icon">&#9888;</span><span>${escapeHtml(sentences.join(" "))}</span></div>${action}`
  );
}

function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function renderHeaderIcon(
  breakdown: Map<Category, CategoryStats>,
  categories: Category[],
  ctx: WidgetContext = {}
): void {
  context = ctx;
  showErrorMarker = false;
  setContent(buildRows(breakdown, categories));
}

export function getHiddenCategories(): ReadonlySet<string> {
  return hiddenCategories;
}

export function resetCategoryFilter(): void {
  hiddenCategories.clear();
}

// ── Core render ───────────────────────────────────────────────────────────────

// The popup is only ever opened by hover — see bindHoverListeners. Rendering content never
// opens it, so navigating from a PR list into a PR no longer pops the widget open unasked.
function setContent(html: string): void {
  const onToggleCategory = context.onToggleCategory;
  const anchor = findDiffstatAnchor();
  if (!anchor) return;

  (anchor as HTMLElement).style.cursor = "pointer";
  syncErrorMarker(anchor);

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

  shadow.querySelector<HTMLElement>(".pin-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setPinned(!pinned);
  });

  const copyButton = shadow.querySelector<HTMLElement>(".copy-md");
  copyButton?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!lastSummary) return;
    const markdown = toMarkdown(lastSummary, { truncated: context.truncated === true });
    try {
      await navigator.clipboard.writeText(markdown);
      flash(copyButton, "Copied", "Copy markdown");
    } catch {
      // Clipboard writes need a focused document; nothing to recover, so say so
      flash(copyButton, "Copy failed", "Copy markdown");
    }
  });

  if (context.onOpenSettings) {
    for (const btn of Array.from(shadow.querySelectorAll<HTMLElement>(".settings-action, .quota"))) {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        context.onOpenSettings?.();
      });
    }
  }

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

  applyPinnedState();

  // Content can change while the popup is open (loading -> rows): keep it anchored.
  if (host.style.display === "block") positionHost(host, anchor);
}

// The marker lives in GitHub's own chip, so it is styled inline like the badges and the
// tree counts, and it takes its red from GitHub's theme.
function syncErrorMarker(anchor: Element): void {
  const existing = anchor.querySelector(`.${MARKER_CLASS}`);

  if (!showErrorMarker) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const dot = document.createElement("span");
  dot.className = MARKER_CLASS;
  dot.setAttribute("role", "img");
  dot.setAttribute("aria-label", "Line breakdown unavailable");
  dot.title = "Line breakdown unavailable — hover for details";
  dot.style.cssText = [
    "display:inline-block",
    "width:7px",
    "height:7px",
    "border-radius:50%",
    "margin-left:6px",
    "vertical-align:middle",
    "flex-shrink:0",
    "background:var(--fgColor-danger, var(--color-danger-fg, #cf222e))",
  ].join(";");
  anchor.appendChild(dot);
}

function flash(button: HTMLElement, message: string, revertTo: string): void {
  button.textContent = message;
  setTimeout(() => {
    button.textContent = revertTo;
  }, 1500);
}

export function setPinned(next: boolean): void {
  pinned = next;
  applyPinnedState();

  const host = document.getElementById(HOST_ID);
  if (!host) return;
  if (pinned && currentAnchor) {
    positionHost(host, currentAnchor);
    host.style.display = "block";
  } else if (!pinned) {
    host.style.display = "none";
  }
}

// Re-applied after every render, since setContent replaces the popup's contents wholesale.
function applyPinnedState(): void {
  shadowRoot?.querySelector(".popup")?.classList.toggle("pinned", pinned);

  const button = shadowRoot?.querySelector<HTMLElement>(".pin-toggle");
  if (button) {
    const label = pinned ? "Unpin — let the popup close again (Esc)" : "Pin — keep the popup open while you read it";
    button.innerHTML = pinned ? PIN_FILLED : PIN_OUTLINE;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(pinned));
  }

  if (currentAnchor instanceof HTMLElement) {
    currentAnchor.title = pinned ? "Click to unpin the line breakdown" : "Click to pin the line breakdown";
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
    if (pinned) return;
    hideTimer = setTimeout(() => { host.style.display = "none"; hideTimer = null; }, 120);
  };

  anchor.addEventListener("mouseenter", show, { signal });
  anchor.addEventListener("mouseleave", scheduleHide, { signal });
  host.addEventListener("mouseenter", show, { signal });
  host.addEventListener("mouseleave", scheduleHide, { signal });

  // Click the diffstat to pin, click again to release. GitHub's chip is not interactive, so
  // there is nothing to get in the way.
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    setPinned(!pinned);
  }, { signal });

  document.addEventListener("keydown", (event) => {
    if (pinned && (event as KeyboardEvent).key === "Escape") setPinned(false);
  }, { signal });

  applyPinnedState();
}

function ensureShadow(): ShadowRoot {
  // The cached root is only usable while its host is still in the document. If something
  // replaced the page's body under us, the cached root is attached to a detached host and
  // every later render would write into nothing — so rebuild instead.
  const existing = document.getElementById(HOST_ID);
  if (shadowRoot && existing?.shadowRoot === shadowRoot) return shadowRoot;

  existing?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "position:absolute;z-index:2147483647;display:none;";
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<style>${STYLES}</style><div class="popup"></div>`;
  return shadowRoot;
}

// ── Styles (Shadow DOM — fully isolated from GitHub's page styles) ────────────

const STYLES = `
  :host {
    all: initial;
    display: block;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  }

  .popup {
    position: relative;
    min-width: 480px;
    padding: 12px 16px 14px;
    background: var(--bgColor-default, var(--color-canvas-default, #ffffff));
    border: 1px solid var(--borderColor-default, var(--color-border-default, #d0d7de));
    border-radius: 8px;
    box-shadow: var(--shadow-floating-small, 0 8px 24px rgba(31,35,40,0.12), 0 2px 6px rgba(31,35,40,0.06));
    font-size: 13px;
    color: var(--fgColor-default, var(--color-fg-default, #1f2328));
    white-space: nowrap;
    cursor: default;
  }

  .popup.pinned {
    border-color: var(--borderColor-accent-emphasis, var(--color-accent-emphasis, #0969da));
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--borderColor-muted, var(--color-border-muted, #eaeef2));
  }

  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--fgColor-default, var(--color-fg-default, #1f2328));
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

  .total-lines  { color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); }
  .total-files  { color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); }
  .total-added  { color: var(--fgColor-success, var(--color-success-fg, #1a7f37)); font-weight: 500; }
  .total-removed { color: var(--fgColor-danger, var(--color-danger-fg, #cf222e)); font-weight: 500; }

  .cat-files {
    color: var(--fgColor-muted, var(--color-fg-muted, #656d76));
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
    color: var(--fgColor-default, var(--color-fg-default, #1f2328));
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
    background: var(--bgColor-neutral-muted, var(--color-neutral-muted, #eaeef2));
  }

  .bar-left  { display: flex; justify-content: flex-end;   border-radius: 3px 0 0 3px; }
  .bar-right { display: flex; justify-content: flex-start; border-radius: 0 3px 3px 0; }

  .bar-fill { height: 100%; transition: width 0.25s ease; }
  .bar-added   { background: var(--bgColor-success-emphasis, var(--color-success-emphasis, #2da44e)); }
  .bar-removed { background: var(--bgColor-danger-emphasis, var(--color-danger-emphasis, #cf222e)); }

  .stat {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    min-width: 48px;
  }

  .stat-added   { color: var(--fgColor-success, var(--color-success-fg, #1a7f37)); }
  .stat-removed { color: var(--fgColor-danger, var(--color-danger-fg, #cf222e)); }

  .pct {
    font-size: 11px;
    color: var(--fgColor-muted, var(--color-fg-muted, #656d76));
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
    color: var(--fgColor-muted, var(--color-fg-muted, #8c959f));
    opacity: 0.5;
    border-radius: 3px;
    width: 20px;
    height: 20px;
    font-family: inherit;
    flex-shrink: 0;
  }

  .cat-toggle:hover {
    opacity: 1;
    background: var(--bgColor-muted, var(--color-canvas-subtle, #f6f8fa));
  }

  .cat-toggle--hidden {
    opacity: 1;
    color: var(--fgColor-danger, var(--color-danger-fg, #cf222e));
  }

  .cat-toggle--hidden:hover {
    background: var(--bgColor-danger-muted, var(--color-danger-subtle, #fff0f0));
  }

  .quota, .settings-action {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .quota { color: var(--fgColor-muted, var(--color-fg-muted, #656d76)); }
  .quota:hover { color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); }
  .settings-action { color: var(--fgColor-accent, var(--color-accent-fg, #0969da)); }

  .footer {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--borderColor-muted, var(--color-border-muted, #eaeef2));
  }
  .footer-gap { flex: 1; }

  .pin-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 18px;
    margin-left: 2px;
    padding: 0;
    background: none;
    border: none;
    border-radius: 3px;
    cursor: pointer;
    color: var(--fgColor-muted, var(--color-fg-muted, #8c959f));
    opacity: .55;
    vertical-align: middle;
  }
  .pin-toggle:hover {
    opacity: 1;
    background: var(--bgColor-muted, var(--color-canvas-subtle, #f6f8fa));
  }
  .popup.pinned .pin-toggle {
    opacity: 1;
    color: var(--fgColor-accent, var(--color-accent-fg, #0969da));
  }

  .copy-md {
    background: none;
    border: none;
    padding: 0;
    font-family: inherit;
    font-size: 11px;
    color: var(--fgColor-accent, var(--color-accent-fg, #0969da));
    cursor: pointer;
  }
  .copy-md:hover { text-decoration: underline; }

  .toggle-empty {
    background: none;
    border: none;
    padding: 0;
    font-size: 11px;
    color: var(--fgColor-accent, var(--color-accent-fg, #0969da));
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
    color: var(--fgColor-muted, var(--color-fg-muted, #656d76));
    font-size: 13px;
  }

  .error {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    color: var(--fgColor-danger, var(--color-danger-fg, #cf222e));
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
    border: 2px solid var(--borderColor-default, var(--color-border-default, #d0d7de));
    border-top-color: var(--fgColor-accent, var(--color-accent-fg, #0969da));
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
`;
