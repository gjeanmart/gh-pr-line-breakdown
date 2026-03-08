import type { Category } from "./config.js";
import type { CategoryStats } from "./matcher.js";

const HOST_ID = "gh-line-breakdown-host";

let currentAnchor: Element | null = null;
let shadowRoot: ShadowRoot | null = null;
let listenerController: AbortController | null = null;

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildRows(
  breakdown: Map<Category, CategoryStats>,
  categories: Category[]
): string {
  const grandTotal = categories.reduce((sum, cat) => sum + (breakdown.get(cat)?.total ?? 0), 0);
  const totalAdded = categories.reduce((sum, cat) => sum + (breakdown.get(cat)?.added ?? 0), 0);
  const totalRemoved = categories.reduce((sum, cat) => sum + (breakdown.get(cat)?.removed ?? 0), 0);
  const scale = Math.max(totalAdded, totalRemoved, 1);

  const rows = categories
    .map((cat) => {
      const stats = breakdown.get(cat) ?? { added: 0, removed: 0, total: 0 };
      const addedPct = (stats.added / scale) * 100;
      const removedPct = (stats.removed / scale) * 100;
      const pct = grandTotal > 0 ? Math.round((stats.total / grandTotal) * 100) : 0;
      return `
      <div class="row">
        <span class="cat-name">${escapeHtml(cat.name)}</span>
        <div class="bar-track">
          <div class="bar-half bar-left">
            <div class="bar-fill bar-removed" style="width:${removedPct.toFixed(1)}%"></div>
          </div>
          <div class="bar-half bar-right">
            <div class="bar-fill bar-added" style="width:${addedPct.toFixed(1)}%"></div>
          </div>
        </div>
        <span class="stat stat-added">+${stats.added.toLocaleString()}</span>
        <span class="stat stat-removed">\u2212${stats.removed.toLocaleString()}</span>
        <span class="pct">${pct}%</span>
      </div>`;
    })
    .join("");

  return `
    <div class="header">
      <span class="title"><svg class="title-icon" width="14" height="14" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="16" y="20" width="88" height="16" rx="4" fill="#0969da"/><rect x="16" y="44" width="72" height="16" rx="4" fill="#1f6feb"/><rect x="16" y="68" width="52" height="16" rx="4" fill="#388bfd"/><rect x="16" y="92" width="32" height="16" rx="4" fill="#79c0ff"/></svg>Line Breakdown</span>
      <span class="totals">
        <span class="total-lines">${grandTotal.toLocaleString()} lines</span>
        <span class="total-added">+${totalAdded.toLocaleString()}</span>
        <span class="total-removed">\u2212${totalRemoved.toLocaleString()}</span>
      </span>
    </div>
    <div class="rows">${rows}</div>
  `;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderLoadingState(): void {
  setContent(`<div class="loading"><span class="spinner"></span>Loading\u2026</div>`, true);
}

export function renderHeaderIcon(
  breakdown: Map<Category, CategoryStats>,
  categories: Category[]
): void {
  setContent(buildRows(breakdown, categories), false);
}

// ── Core render ───────────────────────────────────────────────────────────────

function setContent(html: string, autoShow: boolean): void {
  const anchor = findDiffstatAnchor();
  if (!anchor) return;

  (anchor as HTMLElement).style.cursor = "pointer";

  const shadow = ensureShadow();
  shadow.querySelector<HTMLElement>(".popup")!.innerHTML = html;

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
  .total-added  { color: #1a7f37; font-weight: 500; }
  .total-removed { color: #cf222e; font-weight: 500; }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .row {
    display: grid;
    grid-template-columns: 136px 1fr 54px 54px 32px;
    align-items: center;
    gap: 8px;
  }

  .cat-name {
    font-size: 12px;
    color: #1f2328;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  }

  .stat-added   { color: #1a7f37; }
  .stat-removed { color: #cf222e; }

  .pct {
    font-size: 11px;
    color: #656d76;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .loading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    color: #656d76;
    font-size: 13px;
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
