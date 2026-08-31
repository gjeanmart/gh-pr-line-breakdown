import type { Category } from "./config.js";
import type { CategoryStats } from "./matcher.js";
import type { ApiError, RateLimit } from "./github_api.js";
import { findDiffstatAnchor } from "./anchor.js";
import { safeCssColor } from "./color.js";
import { escapeAttr, escapeHtml } from "./html.js";
import { summarize, toMarkdown, type Summary } from "./summary.js";
import { DEFAULT_PREFS, type Prefs } from "./prefs.js";

const HOST_ID = "gh-line-breakdown-host";

let currentAnchor: Element | null = null;
let shadowRoot: ShadowRoot | null = null;
let prefs: Prefs = { ...DEFAULT_PREFS };
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
  /** How the reader likes to read a breakdown — persisted by the content script. */
  prefs?: Prefs;
  onPrefsChange?: (update: Partial<Prefs>) => void;
  /** Told after any change to the filter, so it can be remembered for this page. */
  onFilterChange?: (hidden: string[]) => void;
};

let context: WidgetContext = {};

// Held open by something other than the pointer — a keyboard press, or a click on the
// launcher. There is no pin control any more: pinning a popup anchored to the page header only
// left it off-screen the moment you scrolled into the diff, which is when you wanted it. The
// sticky launcher solves that properly, by being reachable at any scroll depth.
let heldOpen = false;
// Which element the popup is currently pointing at — the diffstat, or the launcher.
let activeAnchor: HTMLElement | null = null;
const anchors = new Set<HTMLElement>();
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

// Alt on Windows and Linux, Option on a Mac — same event flag, different name on the label.
const MODIFIER =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "")
    ? "\u2325"
    : "Alt";

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
  const summary = summarize(breakdown, categories, { sortBySize: prefs.sortBySize });

  const rows = summary.rows
    .map(({ category, stats, percent, fileLabel, isEmpty, addedWidth, removedWidth }) => {
      const isHidden = hiddenCategories.has(category.name);
      const eyeIcon = isHidden ? EYE_SLASH : EYE_OPEN;
      const eyeTitle = isHidden
        ? `Show ${category.name} files`
        : `Hide ${category.name} files — ${MODIFIER}-click to show only this category`;
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
      ? `<button class="toggle-empty">${prefs.hideEmpty ? `Show ${summary.emptyCount} empty` : "Hide empty"}</button>`
      : "";
  const sortToggle = `<button class="sort-toggle" title="${
    prefs.sortBySize
      ? "Sorted biggest first — switch back to category order"
      : "In category order, which is matching precedence — switch to biggest first"
  }">${prefs.sortBySize ? "By size" : "By order"}</button>`;
  const anyHidden = summary.rows.some((row) => hiddenCategories.has(row.category.name));
  const showAll = anyHidden
    ? `<button class="show-all" title="Show every category again">Show all</button>`
    : "";
  const copyButton = `<button class="copy-md" title="Copy this breakdown as a markdown table">Copy markdown</button>`;
  const quota = buildQuotaHint();
  const footer =
    sortToggle + copyButton + emptyToggle + showAll + (quota ? `<span class="footer-gap"></span>${quota}` : "");

  return `
    <div class="header">
      <span class="title">${TITLE_ICON}Line Breakdown</span>
      <span class="totals">
        <span class="total-lines">${summary.totalLines.toLocaleString()} lines</span>
        <span class="total-files"${truncated ? ` title="${escapeAttr(TRUNCATION_NOTE)}"` : ""}>${truncated ? "first " : ""}${summary.filesLabel}</span>
        <span class="total-added">+${summary.totalAdded.toLocaleString()}</span>
        <span class="total-removed">\u2212${summary.totalRemoved.toLocaleString()}</span>
      </span>
    </div>
    <div class="rows${prefs.hideEmpty ? " hide-empty" : ""}">${rows}</div>
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
  if (ctx.prefs) prefs = ctx.prefs;
  showErrorMarker = false;
  lastRender = { breakdown, categories };
  setContent(buildRows(breakdown, categories));
}

export function getHiddenCategories(): ReadonlySet<string> {
  return hiddenCategories;
}

export function resetCategoryFilter(): void {
  hiddenCategories.clear();
}

/** Restores a filter remembered from a previous visit to this page. */
export function setHiddenCategories(names: Iterable<string>): void {
  hiddenCategories.clear();
  for (const name of names) hiddenCategories.add(name);
}

// Every change to the filter goes through here: it applies the change to the page, tells the
// content script so it can be remembered, and re-renders so the rows agree with reality.
// Three callers now (an eye, "only this", "show all"), which is exactly why it is one function.
function applyFilter(hidden: Set<string>, allCategories: string[]): void {
  for (const name of allCategories) {
    const shouldHide = hidden.has(name);
    if (shouldHide === hiddenCategories.has(name)) continue;
    if (shouldHide) hiddenCategories.add(name);
    else hiddenCategories.delete(name);
    context.onToggleCategory?.(name, !shouldHide);
  }
  context.onFilterChange?.(Array.from(hiddenCategories));
  rerender();
}

// The last rendered breakdown, so a control can re-render without the content script.
let lastRender: { breakdown: Map<Category, CategoryStats>; categories: Category[] } | null = null;

function rerender(): void {
  if (!lastRender) return;
  setContent(buildRows(lastRender.breakdown, lastRender.categories));
}

// ── Core render ───────────────────────────────────────────────────────────────

// Rendering content never opens the popup: it is opened by pointing at an anchor or focusing
// one. Navigating from a PR list into a PR does not pop it open unasked.
function setContent(html: string): void {
  const onToggleCategory = context.onToggleCategory;

  // The diffstat is optional. It is the obvious way into the popup when the page header is on
  // screen, but the launcher is a way in that does not depend on it — and rendering used to
  // stop dead here, which left the launcher opening an empty box on any page where anchor
  // detection came up short.
  const anchor = findDiffstatAnchor();
  if (anchor) {
    (anchor as HTMLElement).style.cursor = "pointer";
    syncErrorMarker(anchor);
  }

  const shadow = ensureShadow();
  shadow.querySelector<HTMLElement>(".popup")!.innerHTML = html;

  shadow.querySelector(".toggle-empty")?.addEventListener("click", (event) => {
    event.stopPropagation();
    prefs = { ...prefs, hideEmpty: !prefs.hideEmpty };
    context.onPrefsChange?.({ hideEmpty: prefs.hideEmpty });
    rerender();
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

  const categoryNames = lastRender?.categories.map((category) => category.name) ?? [];

  if (onToggleCategory) {
    for (const btn of Array.from(shadow.querySelectorAll<HTMLElement>(".cat-toggle"))) {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const name = btn.dataset.cat!;

        if ((event as MouseEvent).altKey) {
          // Show only this one. On a nine-category config that is one click instead of eight.
          applyFilter(new Set(categoryNames.filter((other) => other !== name)), categoryNames);
          return;
        }

        const hidden = new Set(hiddenCategories);
        if (hidden.has(name)) hidden.delete(name);
        else hidden.add(name);
        applyFilter(hidden, categoryNames);
      });
    }
  }

  shadow.querySelector<HTMLElement>(".show-all")?.addEventListener("click", (event) => {
    event.stopPropagation();
    applyFilter(new Set(), categoryNames);
  });

  shadow.querySelector<HTMLElement>(".sort-toggle")?.addEventListener("click", (event) => {
    event.stopPropagation();
    prefs = { ...prefs, sortBySize: !prefs.sortBySize };
    context.onPrefsChange?.({ sortBySize: prefs.sortBySize });
    rerender();
  });

  const host = document.getElementById(HOST_ID) as HTMLElement;

  if (anchor && anchor !== currentAnchor) {
    currentAnchor = anchor;
    bindDiffstatAnchor(anchor);
  }

  applyOpenState();

  // Content can change while the popup is open (loading -> rows): keep it anchored.
  if (host.style.display === "block" && activeAnchor) positionHost(host, activeAnchor);
}

// The marker lives in GitHub's own chip rather than in the widget's shadow root, so it is
// styled by injected.css along with the badges and the tree counts.
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
  anchor.appendChild(dot);
}

function flash(button: HTMLElement, message: string, revertTo: string): void {
  button.textContent = message;
  setTimeout(() => {
    button.textContent = revertTo;
  }, 1500);
}

export function setHeldOpen(next: boolean, anchor?: HTMLElement): void {
  heldOpen = next;
  if (anchor) activeAnchor = anchor;
  if (heldOpen) openAt(activeAnchor ?? currentAnchor);
  else close();
}

// Re-applied after every render, since setContent replaces the popup's contents wholesale.
function applyOpenState(): void {
  const open = isOpen();
  for (const anchor of anchors) {
    // React replaces the diffstat freely, so anchors accumulate. Drop the detached ones here
    // rather than holding every node GitHub has ever rendered for the life of the tab.
    if (!anchor.isConnected) anchors.delete(anchor);
    else anchor.setAttribute("aria-expanded", String(open));
  }
}

function isOpen(): boolean {
  return document.getElementById(HOST_ID)?.style.display === "block";
}

function openAt(anchor: Element | null): void {
  const host = document.getElementById(HOST_ID);
  if (!host || !anchor) return;
  cancelClose();
  if (anchor instanceof HTMLElement) activeAnchor = anchor;
  positionHost(host, anchor);
  host.style.display = "block";
  // Same function reference every time, so these do not stack up
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("resize", reposition, { passive: true });
  applyOpenState();
}

function close(): void {
  const host = document.getElementById(HOST_ID);
  if (host) host.style.display = "none";
  window.removeEventListener("scroll", reposition);
  window.removeEventListener("resize", reposition);
  applyOpenState();
}

// The popup is positioned in viewport coordinates and follows its anchor while the page
// scrolls. It used to be placed in document coordinates, which is why an open popup slid off
// the top of the screen the moment you scrolled down into the diff — the reason the old pin
// was useless, and the reason the launcher works.
function reposition(): void {
  const host = document.getElementById(HOST_ID);
  if (host && isOpen() && activeAnchor) positionHost(host, activeAnchor);
}

function positionHost(host: HTMLElement, anchor: Element): void {
  const rect = anchor.getBoundingClientRect();
  host.style.top = `${rect.bottom + 8}px`;
  requestAnimationFrame(() => {
    // Never off the left edge, however narrow the window
    host.style.left = `${Math.max(8, rect.right - host.offsetWidth)}px`;
  });
}

/**
 * Give an element the open-on-hover, open-on-focus, toggle-on-click behaviour. Called for
 * GitHub's diffstat and for our own launcher, so the two are one popup with two ways in
 * rather than two implementations that drift.
 *
 * The host is looked up per event rather than captured: ensureShadow replaces it whenever
 * something has torn the old one out of the document, and a captured reference would leave
 * every listener bound here writing into a detached node for the rest of the session.
 */
export function attachAnchor(anchor: HTMLElement): void {
  if (anchors.has(anchor)) return;
  anchors.add(anchor);

  anchor.setAttribute("aria-expanded", String(isOpen()));
  anchor.addEventListener("mouseenter", () => openAt(anchor));
  anchor.addEventListener("mouseleave", () => scheduleClose());
  anchor.addEventListener("focus", () => setHeldOpen(true, anchor));
  anchor.addEventListener("blur", (event) => {
    // Tabbing from the anchor into the popup's own buttons must not close it. The popup lives
    // in a shadow root, so focus lands on the host element as far as this listener can see.
    const next = (event as FocusEvent).relatedTarget;
    if (next instanceof Node && document.getElementById(HOST_ID)?.contains(next)) return;
    if (heldOpen) setHeldOpen(false);
  });
  anchor.addEventListener("click", (event) => {
    event.preventDefault();
    setHeldOpen(!heldOpen, anchor);
  });
  anchor.addEventListener("keydown", (event) => {
    const key = (event as KeyboardEvent).key;
    if (key !== "Enter" && key !== " ") return;
    event.preventDefault();
    setHeldOpen(!heldOpen, anchor);
  });
}

let closeTimer: ReturnType<typeof setTimeout> | null = null;

// A grace period, so the pointer can cross the gap between the anchor and the popup.
function scheduleClose(): void {
  if (heldOpen) return;
  cancelClose();
  closeTimer = setTimeout(() => {
    closeTimer = null;
    close();
  }, 120);
}

function cancelClose(): void {
  if (closeTimer !== null) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

// GitHub's diffstat is not interactive, so it is made into one: focusable, labelled as a
// button, and driving the popup exactly as the launcher does.
function bindDiffstatAnchor(anchor: Element): void {
  if (!(anchor instanceof HTMLElement)) return;

  anchor.tabIndex = 0;
  anchor.setAttribute("role", "button");
  anchor.title = "Line breakdown";
  attachAnchor(anchor);
}

// The popup keeps itself open while the pointer is on it, so moving from an anchor onto the
// popup does not close it. Bound once, when the host is created.
function bindHostHover(host: HTMLElement): void {
  host.addEventListener("mouseenter", () => {
    cancelClose();
    host.style.display = "block";
  });
  host.addEventListener("mouseleave", () => scheduleClose());

  // Escape belongs to the popup, not to any one anchor. It used to be bound alongside the
  // diffstat, which left a popup opened from the launcher undismissable by keyboard on a page
  // where the diffstat was never found.
  escapeController?.abort();
  escapeController = new AbortController();
  document.addEventListener(
    "keydown",
    (event) => {
      if (heldOpen && (event as KeyboardEvent).key === "Escape") setHeldOpen(false);
    },
    { signal: escapeController.signal }
  );
}

let escapeController: AbortController | null = null;

function ensureShadow(): ShadowRoot {
  // The cached root is only usable while its host is still in the document. If something
  // replaced the page's body under us, the cached root is attached to a detached host and
  // every later render would write into nothing — so rebuild instead.
  const existing = document.getElementById(HOST_ID);
  if (shadowRoot && existing?.shadowRoot === shadowRoot) return shadowRoot;

  existing?.remove();

  const host = document.createElement("div");
  host.id = HOST_ID;
  // Only the runtime state is inline; position and stacking are in :host, below. Starting
  // hidden matters before anything renders, which is why display is set here.
  host.style.display = "none";
  document.body.appendChild(host);

  bindHostHover(host);
  shadowRoot = host.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<style>${STYLES}</style><div class="popup"></div>`;
  return shadowRoot;
}

// ── Styles (Shadow DOM — fully isolated from GitHub's page styles) ────────────

const STYLES = `
  :host {
    /* all: initial does not reset custom properties, which is what lets GitHub's theme
       variables reach the rules below. It does reset everything else, so position and
       stacking are re-declared here rather than inline on the host element. */
    all: initial;
    display: block;
    position: fixed;
    z-index: 2147483647;
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
