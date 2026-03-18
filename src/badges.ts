import type { Category } from "./config.js";
import type { FileEntry } from "./matcher.js";
import { classifyFile } from "./matcher.js";

const BADGE_CLASS = "gh-breakdown-badge";
const EXPAND_LABEL_PREFIX = "Expand all lines: ";
// Attribute placed on a file's section element when collapsed by our category filter
const FILTER_ATTR = "data-gh-breakdown-filtered";

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
  const injectedPaths = new Set<string>();

  // === Classic GitHub UI: .file-header[data-path] ===
  for (const header of Array.from(document.querySelectorAll<HTMLElement>(".file-header[data-path]"))) {
    if (header.querySelector(`.${BADGE_CLASS}`)) continue;
    const path = header.getAttribute("data-path");
    if (!path) continue;
    const category = fileMap.get(path);
    if (!category) continue;
    (header.querySelector(".file-info") ?? header).appendChild(createBadge(category));
    fileHeaderMap.set(path, header);
    injectedPaths.add(path);
  }

  // === New GitHub Primer UI — Strategy 1 ===
  // "Expand all lines: {path}" buttons encode the full path in their aria-label.
  for (const btn of Array.from(document.querySelectorAll<HTMLElement>(`button[aria-label^="${EXPAND_LABEL_PREFIX}"]`))) {
    const path = (btn.getAttribute("aria-label") ?? "").slice(EXPAND_LABEL_PREFIX.length).trim();
    if (!path || injectedPaths.has(path)) continue;
    const headerContainer = findHeaderContainer(btn);
    if (!headerContainer || headerContainer.querySelector(`.${BADGE_CLASS}`)) continue;
    const category = fileMap.get(path);
    if (!category) continue;
    injectedPaths.add(path);
    fileHeaderMap.set(path, headerContainer);
    const viewedBtn = headerContainer.querySelector<HTMLElement>("button[aria-label*='Viewed']");
    if (viewedBtn) {
      viewedBtn.insertAdjacentElement("beforebegin", createBadge(category));
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

    const headerContainer = findHeaderContainer(anchor);
    if (!headerContainer || headerContainer.querySelector(`.${BADGE_CLASS}`)) continue;

    const category = fileMap.get(blobPath);
    if (!category) continue;
    injectedPaths.add(blobPath);
    fileHeaderMap.set(blobPath, headerContainer);

    const viewedBtn = headerContainer.querySelector<HTMLElement>("button[aria-label*='Viewed']");
    if (viewedBtn) {
      viewedBtn.insertAdjacentElement("beforebegin", createBadge(category));
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

    const headerContainer = findHeaderContainer(anchor);
    if (!headerContainer || headerContainer.querySelector(`.${BADGE_CLASS}`)) continue;

    injectedPaths.add(entry.filePath);
    fileHeaderMap.set(entry.filePath, headerContainer);
    const viewedBtn = headerContainer.querySelector<HTMLElement>("button[aria-label*='Viewed']");
    if (viewedBtn) {
      viewedBtn.insertAdjacentElement("beforebegin", createBadge(entry.category));
    }
  }
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

// Ancestor layout from debug (GitHub Primer React, no <details>):
//   level 0: DiffFileHeader-module__diff-file-header  ← header (what we store)
//   level 1: Diff-module__diffHeaderWrapper            ← header wrapper
//   level 2: Diff-module__diffTargetable               ← full file section (header + diff body)
//
// Collapsing = hide all children of fileSection except the headerWrapper.
// This keeps the file header visible, exactly like GitHub's native collapse button.

function collapseFile(header: HTMLElement): boolean {
  const headerWrapper = header.parentElement;
  const fileSection = headerWrapper?.parentElement;
  if (!fileSection || fileSection.hasAttribute(FILTER_ATTR)) return false;

  for (const child of Array.from(fileSection.children) as HTMLElement[]) {
    if (child !== headerWrapper) child.style.display = "none";
  }
  fileSection.setAttribute(FILTER_ATTR, "1");
  return true;
}

function expandFile(header: HTMLElement): void {
  const headerWrapper = header.parentElement;
  const fileSection = headerWrapper?.parentElement;
  if (!fileSection) return;

  for (const child of Array.from(fileSection.children) as HTMLElement[]) {
    if (child !== headerWrapper) child.style.display = "";
  }
  fileSection.removeAttribute(FILTER_ATTR);
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
// We identify it as the SMALLEST ancestor that contains exactly one "Viewed" button
// (a container with multiple would be the all-files wrapper, which is too broad).
function findHeaderContainer(el: HTMLElement): HTMLElement | null {
  let container: HTMLElement | null = el.parentElement;
  for (let i = 0; i < 12 && container; i++) {
    const viewedBtns = container.querySelectorAll("button[aria-label*='Viewed']");
    if (viewedBtns.length === 1) return container;
    if (viewedBtns.length > 1) return null; // overshot — multiple files in this container
    container = container.parentElement;
  }
  return null;
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
