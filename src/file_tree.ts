import type { FileEntry } from "./matcher.js";

const TREE_COUNT_CLASS = "gh-breakdown-tree-count";

export interface LineStats {
  added: number;
  removed: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Inject +N −N line counts into GitHub's PR file tree sidebar.
 *
 * GitHub's Primer React TreeView sets id="full/path/to/file" on every
 * [role="treeitem"] <li>, so we can match files and folders directly without
 * hashing. Folder stats are rolled up from all files under that path prefix.
 *
 * Returns the number of counts injected, so the caller can tell whether the page changed.
 *
 * The count is injected into the item's content row
 * (div[class*="TreeView-item-content"]), which is a flex container, so
 * margin-left:auto pushes the count to the right edge.
 */
export function injectTreeCounts(files: FileEntry[]): number {
  if (files.length === 0) return 0;

  const treeRoot = findFileTree();
  if (!treeRoot) return 0;

  const items = Array.from(treeRoot.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  // Already counted every row we can count — nothing to do until the tree changes
  if (treeRoot.querySelectorAll(`.${TREE_COUNT_CLASS}`).length >= items.length) return 0;

  const { fileMap, folderMap } = buildMaps(files);
  let injected = 0;

  for (const item of items) {
    if (item.querySelector(`.${TREE_COUNT_CLASS}`)) continue;

    const path = item.id;
    if (!path) continue;

    const stats = fileMap.get(path) ?? folderMap.get(path);
    if (!stats) continue;

    // The content row is the flex div containing the icon and label text.
    // Fall back to the <li> itself if the inner div isn't found.
    const row = item.querySelector<HTMLElement>('[class*="TreeView-item-content"]') ?? item;
    row.appendChild(createCount(stats));
    injected++;
  }

  return injected;
}

export function clearTreeCounts(): void {
  document.querySelectorAll(`.${TREE_COUNT_CLASS}`).forEach((el) => el.remove());
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

export function buildMaps(files: FileEntry[]): {
  fileMap: Map<string, LineStats>;
  folderMap: Map<string, LineStats>;
} {
  const fileMap = new Map<string, LineStats>();
  const folderMap = new Map<string, LineStats>();

  for (const f of files) {
    fileMap.set(f.filename, { added: f.added, removed: f.removed });

    // Roll up into every ancestor folder.
    // "src/foo/bar.ts" contributes to "src/foo" and "src".
    const parts = f.filename.split("/");
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join("/");
      const existing = folderMap.get(folder) ?? { added: 0, removed: 0 };
      folderMap.set(folder, {
        added: existing.added + f.added,
        removed: existing.removed + f.removed,
      });
    }
  }

  return { fileMap, folderMap };
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────

function findFileTree(): HTMLElement | null {
  // GitHub Primer React TreeView — aria-label is set to "File Tree" (capital T)
  return (
    document.querySelector<HTMLElement>('[aria-label="File Tree"]') ??
    document.querySelector<HTMLElement>('[role="tree"]') ??
    null
  );
}

function createCount(stats: LineStats): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = TREE_COUNT_CLASS;
  wrap.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:3px",
    "margin-left:auto",
    "padding-left:6px",
    "font-size:11px",
    "font-family:ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,monospace",
    "flex-shrink:0",
    "white-space:nowrap",
  ].join(";");

  if (stats.added > 0) {
    const add = document.createElement("span");
    add.style.color = "var(--fgColor-success, var(--color-success-fg, #1a7f37))";
    add.textContent = `+${stats.added}`;
    wrap.appendChild(add);
  }
  if (stats.removed > 0) {
    const rm = document.createElement("span");
    rm.style.color = "var(--fgColor-danger, var(--color-danger-fg, #cf222e))";
    rm.textContent = `−${stats.removed}`;
    wrap.appendChild(rm);
  }

  return wrap;
}
