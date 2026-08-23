import type { Category } from "./config.js";
import type { FileEntry } from "./matcher.js";
import { classifyFile } from "./matcher.js";

const BADGE_CLASS = "gh-breakdown-badge";
const EXPAND_LABEL_PREFIX = "Expand all lines: ";
// Attribute placed on a file's section element when collapsed by our category filter
const FILTER_ATTR = "data-gh-breakdown-filtered";
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

export async function injectBadges(files: FileEntry[], categories: Category[]): Promise<void> {
  const fileMap = new Map<string, Category>();
  for (const file of files) {
    fileMap.set(file.filename, classifyFile(file.filename, categories));
  }
  // Per-call set: prevents two strategies from processing the same path in one call.
  const injectedPaths = new Set<string>();

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
    }
  }

  // === New GitHub Primer UI — Strategy 3 ===
  // For files without an expand button and no full blob URL (e.g. new files with all additions),
  // the file header contains a "#diff-{sha256(path)}" anchor.
  const hashMap = await buildHashMap(fileMap);
  for (const anchor of Array.from(document.querySelectorAll<HTMLElement>('a[href^="#diff-"]'))) {
    const href = anchor.getAttribute("href") ?? "";
    const hash = href.slice(6); // remove "#diff-"
    const entry = hashMap.get(hash);
    if (!entry || injectedPaths.has(entry.filePath)) continue;
    if (anchor.closest(`[${INJECTED_ATTR}]`)) continue;
    const headerContainer = findHeaderContainer(anchor);
    if (!headerContainer) continue;
    injectedPaths.add(entry.filePath);
    fileHeaderMap.set(entry.filePath, headerContainer);
    if (!headerContainer.querySelector(`.${BADGE_CLASS}`)) {
      insertBadge(headerContainer, createBadge(entry.category));
    }
  }

  // Remove within-call markers so the NEXT injectBadges() call can refresh fileHeaderMap
  // (React may re-render containers between calls; markers must not block refreshes).
  document.querySelectorAll(`[${INJECTED_ATTR}]`).forEach((el) => el.removeAttribute(INJECTED_ATTR));
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
      if (collapseFile(header)) filteredFiles.add(filename);
    } else {
      if (!filteredFiles.has(filename)) continue;
      expandFile(header);
      filteredFiles.delete(filename);
    }
  }
}

// Collapsing strategy — works for both PR pages and commit pages:
//
// 1. Find fileSection via CSS module class substring "diffTargetable" (present in
//    Diff-module__diffTargetable__<hash>).  This is more robust than fixed-depth
//    traversal because the header→fileSection depth differs between PR and commit pages.
// 2. Find the direct child of fileSection that is an ancestor of `header` — this is
//    the "header branch" (diffHeaderWrapper on PR pages, possibly different on commit).
// 3. Hide all other direct children of fileSection (the diff body).
//    If there are none (pre-collapsed file with no diff body loaded), hide the entire
//    fileSection instead so the row disappears from view.

// PR pages (Primer React):
//   header [0] → diffHeaderWrapper [1] → diffTargetable [2] (header + diff body as siblings)
//   Strategy: find diffTargetable via CSS class; hide non-header children (diff body).
//
// Commit pages:
//   header [0] → diffHeaderWrapper [1, children:1] → wrapper [2, children:1]
//     → file-wrapper [3, children:1] → all-files container [4, children:N]
//   The diff content is toggled by a CSS class on the header, not by DOM siblings.
//   Strategy: hide the individual file wrapper (first ancestor whose parent has >1 children).

// PR strategy: find diffTargetable by CSS class.
function findDiffTargetable(from: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = from.parentElement;
  for (let i = 0; i < 12 && el; i++) {
    const cls = typeof el.className === "string" ? el.className : "";
    if (cls && /diffTargetable/i.test(cls)) return el;
    el = el.parentElement;
  }
  return null;
}

// Return the direct child of `section` that contains `header` (or is `header`).
function findHeaderBranch(header: HTMLElement, section: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = header;
  while (el) {
    if (el.parentElement === section) return el;
    el = el.parentElement;
  }
  return null;
}

// Commit strategy: find the individual file wrapper = first ancestor whose parent has >1 children.
// That parent is the all-files container; this ancestor is the single-file row within it.
function findIndividualFileWrapper(header: HTMLElement): HTMLElement | null {
  let el: HTMLElement = header;
  for (let depth = 0; depth < 12; depth++) {
    const parent = el.parentElement;
    if (!parent) break;
    if (parent.children.length > 1) return el;
    el = parent;
  }
  return null;
}

function collapseFile(header: HTMLElement): boolean {
  // Strategy 1 — PR pages: hide diff body, keep file header visible.
  const diffTargetable = findDiffTargetable(header);
  if (diffTargetable && !diffTargetable.hasAttribute(FILTER_ATTR)) {
    const headerBranch = findHeaderBranch(header, diffTargetable);
    if (headerBranch) {
      let hiddenAny = false;
      for (const child of Array.from(diffTargetable.children) as HTMLElement[]) {
        if (child !== headerBranch) {
          child.style.display = "none";
          hiddenAny = true;
        }
      }
      // No diff body in DOM (pre-collapsed) — hide the entire section.
      if (!hiddenAny) diffTargetable.style.display = "none";
      diffTargetable.setAttribute(FILTER_ATTR, "1");
      return true;
    }
  }

  // Strategy 2 — Commit pages: hide the entire individual file wrapper.
  const fileWrapper = findIndividualFileWrapper(header);
  if (fileWrapper && !fileWrapper.hasAttribute(FILTER_ATTR)) {
    fileWrapper.style.display = "none";
    fileWrapper.setAttribute(FILTER_ATTR, "1");
    return true;
  }

  return false;
}

function expandFile(header: HTMLElement): void {
  // Walk up from header to find the element stamped with FILTER_ATTR by collapseFile.
  let el: HTMLElement | null = header.parentElement;
  for (let i = 0; i < 14 && el; i++) {
    if (el.hasAttribute(FILTER_ATTR)) {
      el.style.display = "";
      for (const child of Array.from(el.children) as HTMLElement[]) {
        (child as HTMLElement).style.display = "";
      }
      el.removeAttribute(FILTER_ATTR);
      return;
    }
    el = el.parentElement;
  }
}

async function buildHashMap(
  fileMap: Map<string, Category>
): Promise<Map<string, { filePath: string; category: Category }>> {
  const map = new Map<string, { filePath: string; category: Category }>();
  await Promise.all(
    Array.from(fileMap.entries()).map(async ([filePath, category]) => {
      const hash = await sha256hex(filePath);
      map.set(hash, { filePath, category });
    })
  );
  return map;
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
  const color = category.color ?? "#8c959f";
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
    "color:#ffffff",
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
