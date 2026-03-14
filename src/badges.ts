import type { Category } from "./config.js";
import type { FileEntry } from "./matcher.js";
import { classifyFile } from "./matcher.js";

const BADGE_CLASS = "gh-breakdown-badge";
const EXPAND_LABEL_PREFIX = "Expand all lines: ";

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
    const viewedBtn = headerContainer.querySelector<HTMLElement>("button[aria-label*='Viewed']");
    if (viewedBtn) {
      viewedBtn.insertAdjacentElement("beforebegin", createBadge(category));
    }
  }

  // === New GitHub Primer UI — Strategy 2 ===
  // Every file header contains a blob anchor: /owner/repo/blob/{sha}/{path}
  // The file path is embedded in the URL — no class constraints needed, no text matching.
  // `findHeaderContainer` (exactly-one-Viewed-button check) ensures we only process
  // real file header rows and not other /blob/ links on the page.
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

    // Insert before the "Viewed/Not Viewed" button — visible and consistently positioned
    const viewedBtn = headerContainer.querySelector<HTMLElement>("button[aria-label*='Viewed']");
    if (viewedBtn) {
      viewedBtn.insertAdjacentElement("beforebegin", createBadge(category));
    }
  }

  // === New GitHub Primer UI — Strategy 3 ===
  // For files without an expand button and no full blob URL (e.g. new files with all additions),
  // the file header contains a "#diff-{sha256(path)}" anchor.
  // We precompute SHA-256 of all file paths and match against these diff IDs.
  const hashMap = await buildHashMap(fileMap);
  for (const anchor of Array.from(document.querySelectorAll<HTMLElement>('a[href^="#diff-"]'))) {
    const href = anchor.getAttribute("href") ?? "";
    const hash = href.slice(6); // remove "#diff-"
    const entry = hashMap.get(hash);
    if (!entry || injectedPaths.has(entry.filePath)) continue;

    const headerContainer = findHeaderContainer(anchor);
    if (!headerContainer || headerContainer.querySelector(`.${BADGE_CLASS}`)) continue;

    injectedPaths.add(entry.filePath);
    const viewedBtn = headerContainer.querySelector<HTMLElement>("button[aria-label*='Viewed']");
    if (viewedBtn) {
      viewedBtn.insertAdjacentElement("beforebegin", createBadge(entry.category));
    }
  }
}

export function clearBadges(): void {
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach((el) => el.remove());
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
