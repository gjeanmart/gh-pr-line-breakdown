import type { Category } from "./config.js";
import type { FileEntry } from "./matcher.js";
import { classifyFile } from "./matcher.js";
import { collapseFile, expandFile } from "./collapse.js";
import { readableTextColor, safeCssColor } from "./color.js";

const BADGE_CLASS = "gh-breakdown-badge";
const EXPAND_LABEL_PREFIX = "Expand all lines: ";
// Attribute stamped on a header container by insertBadge() to prevent a second strategy
// from injecting a duplicate badge during the SAME injectBadges() call.
// Cleared at the end of every injectBadges() call so the next call refreshes fileHeaderMap.
const INJECTED_ATTR = "data-gh-bd-injected";

// Maps filename → file header container (smallest ancestor with exactly one "Viewed" button).
// Populated during badge injection — used by the category filter to locate diff sections.
const fileHeaderMap: Map<string, HTMLElement> = new Map();
// Tracks filenames collapsed by our filter so we only re-expand those we collapsed,
// not files the user had already manually collapsed.
const filteredFiles: Set<string> = new Set();

export async function injectBadges(files: FileEntry[], categories: Category[]): Promise<number> {
  const fileMap = new Map<string, Category>();
  for (const file of files) {
    fileMap.set(file.filename, classifyFile(file.filename, categories));
  }
  // Per-call set: prevents two strategies from processing the same path in one call.
  const injectedPaths = new Set<string>();
  let injected = 0;

  // === Classic GitHub UI: .file-header[data-path] ===
  for (const header of Array.from(document.querySelectorAll<HTMLElement>(".file-header[data-path]"))) {
    const path = header.getAttribute("data-path");
    if (!path || injectedPaths.has(path)) continue;
    if (header.closest(`[${INJECTED_ATTR}]`)) continue;
    const category = fileMap.get(path);
    if (!category) continue;
    injectedPaths.add(path);
    fileHeaderMap.set(path, header);
    if (!header.querySelector(`.${BADGE_CLASS}`)) {
      header.setAttribute(INJECTED_ATTR, "1");
      (header.querySelector(".file-info") ?? header).appendChild(createBadge(category));
      injected++;
    }
  }

  // === New GitHub Primer UI — Strategy 1 ===
  // "Expand all lines: {path}" buttons encode the full path in their aria-label.
  for (const btn of Array.from(document.querySelectorAll<HTMLElement>(`button[aria-label^="${EXPAND_LABEL_PREFIX}"]`))) {
    const path = (btn.getAttribute("aria-label") ?? "").slice(EXPAND_LABEL_PREFIX.length).trim();
    if (!path || injectedPaths.has(path)) continue;
    if (btn.closest(`[${INJECTED_ATTR}]`)) continue;
    const headerContainer = findHeaderContainer(btn);
    if (!headerContainer) continue;
    const category = fileMap.get(path);
    if (!category) continue;
    injectedPaths.add(path);
    fileHeaderMap.set(path, headerContainer);
    if (!headerContainer.querySelector(`.${BADGE_CLASS}`)) {
      insertBadge(headerContainer, createBadge(category));
      injected++;
    }
  }

  // === New GitHub Primer UI — Strategy 2 ===
  // Every file header contains a blob anchor: /owner/repo/blob/{sha}/{path}
  for (const anchor of Array.from(document.querySelectorAll<HTMLElement>("a[href*='/blob/']"))) {
    const href = anchor.getAttribute("href") ?? "";
    const m = href.match(/\/blob\/[^/]+\/(.+?)(?:[?#].*)?$/);
    if (!m) continue;
    const blobPath = m[1];
    if (!fileMap.has(blobPath) || injectedPaths.has(blobPath)) continue;
    if (anchor.closest(`[${INJECTED_ATTR}]`)) continue;
    const headerContainer = findHeaderContainer(anchor);
    if (!headerContainer) continue;
    const category = fileMap.get(blobPath);
    if (!category) continue;
    injectedPaths.add(blobPath);
    fileHeaderMap.set(blobPath, headerContainer);
    if (!headerContainer.querySelector(`.${BADGE_CLASS}`)) {
      insertBadge(headerContainer, createBadge(category));
      injected++;
    }
  }

  // === New GitHub Primer UI — Strategy 3 ===
  // For files without an expand button and no full blob URL (e.g. new files with all additions),
  // the file header contains a "#diff-{sha256(path)}" anchor.
  const diffAnchors = Array.from(document.querySelectorAll<HTMLElement>('a[href^="#diff-"]'));
  // Hashing is only worth it if a file is still unaccounted for: strategies 1 and 2 resolve
  // most headers, and this pass runs after every settled batch of mutations.
  const pathByHash =
    diffAnchors.length > 0 && injectedPaths.size < files.length
      ? await pathsByDiffHash(files)
      : new Map<string, string>();
  for (const anchor of diffAnchors) {
    const href = anchor.getAttribute("href") ?? "";
    const path = pathByHash.get(href.slice(6)); // remove "#diff-"
    const category = path ? fileMap.get(path) : undefined;
    if (!path || !category || injectedPaths.has(path)) continue;
    if (anchor.closest(`[${INJECTED_ATTR}]`)) continue;
    const headerContainer = findHeaderContainer(anchor);
    if (!headerContainer) continue;
    injectedPaths.add(path);
    fileHeaderMap.set(path, headerContainer);
    if (!headerContainer.querySelector(`.${BADGE_CLASS}`)) {
      insertBadge(headerContainer, createBadge(category));
      injected++;
    }
  }

  // Remove within-call markers so the NEXT injectBadges() call can refresh fileHeaderMap
  // (React may re-render containers between calls; markers must not block refreshes).
  document.querySelectorAll(`[${INJECTED_ATTR}]`).forEach((el) => el.removeAttribute(INJECTED_ATTR));

  return injected;
}

export function clearBadges(): void {
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
  fileHeaderMap.clear();
  filteredFiles.clear();
}

export function setFilesVisible(filenames: string[], visible: boolean): void {
  for (const filename of filenames) {
    const header = fileHeaderMap.get(filename);
    if (!header) continue;

    if (!visible) {
      // Skip files we already collapsed. content_script re-applies active filters after
      // every DOM refresh, and without this a file the user deliberately expanded inside
      // a hidden category would be slammed shut again on the next mutation.
      if (filteredFiles.has(filename)) continue;
      if (collapseFile(header)) filteredFiles.add(filename);
    } else {
      if (!filteredFiles.has(filename)) continue;
      expandFile(header);
      filteredFiles.delete(filename);
    }
  }
}

// Strategy 3 hashes every path in the PR with SHA-256. The file list is stable for the
// whole page, so the map is cached against it rather than rebuilt on every pass.
const hashMapCache = new WeakMap<FileEntry[], Promise<Map<string, string>>>();

function pathsByDiffHash(files: FileEntry[]): Promise<Map<string, string>> {
  const cached = hashMapCache.get(files);
  if (cached) return cached;

  const building = Promise.all(
    files.map(async (file) => [await sha256hex(file.filename), file.filename] as const)
  ).then((pairs) => new Map(pairs));

  hashMapCache.set(files, building);
  return building;
}

async function sha256hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Walk up from el to find the individual file header row.
// Primary: smallest ancestor with exactly one "Viewed" button (PR pages only).
// Fallback: ancestor whose CSS module class name contains "diff-file-header" or
// "DiffFileHeader" — Primer React commit pages use this pattern without "Viewed" buttons.
function findHeaderContainer(el: HTMLElement): HTMLElement | null {
  let container: HTMLElement | null = el.parentElement;
  for (let i = 0; i < 12 && container; i++) {
    const viewedBtns = container.querySelectorAll("button[aria-label*='Viewed']");
    if (viewedBtns.length === 1) return container;
    if (viewedBtns.length > 1) return null; // overshot — multiple files in this container

    // Commit page fallback: Primer React file header identified by CSS module class
    const cls = typeof container.className === "string" ? container.className : "";
    if (cls && /diff-file-header|DiffFileHeader/i.test(cls)) return container;

    container = container.parentElement;
  }
  return null;
}

// Insert badge before the "Viewed" button (PR pages) or before the last action button
// in the header (commit pages, which have no "Viewed" button).
// Stamps INJECTED_ATTR on the container to block other strategies from injecting during
// the same injectBadges() call (cleared at the end of the call).
function insertBadge(headerContainer: HTMLElement, badge: HTMLElement): void {
  headerContainer.setAttribute(INJECTED_ATTR, "1");

  const viewedBtn = headerContainer.querySelector<HTMLElement>("button[aria-label*='Viewed']");
  if (viewedBtn) {
    viewedBtn.insertAdjacentElement("beforebegin", badge);
    return;
  }
  // Commit page: no "Viewed" button — insert before the last button in the header
  // (typically the "..." more-options button) so the badge sits with the action area.
  const allBtns = headerContainer.querySelectorAll<HTMLElement>("button");
  const lastBtn = allBtns[allBtns.length - 1];
  if (lastBtn) {
    lastBtn.insertAdjacentElement("beforebegin", badge);
  } else {
    headerContainer.appendChild(badge);
  }
}

function createBadge(category: Category): HTMLElement {
  const color = safeCssColor(category.color);
  const badge = document.createElement("span");
  badge.className = BADGE_CLASS;
  badge.textContent = category.name;
  badge.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "padding:1px 7px",
    "border-radius:10px",
    "font-size:11px",
    "font-weight:500",
    `color:${readableTextColor(color)}`,
    `background:${color}`,
    "white-space:nowrap",
    "line-height:18px",
    "margin-right:8px",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
    "vertical-align:middle",
    "cursor:default",
    "flex-shrink:0",
  ].join(";");
  return badge;
}
