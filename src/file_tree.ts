import type { FileEntry } from "./matcher.js";

const TREE_COUNT_CLASS = "gh-breakdown-tree-count";

interface LineStats {
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
 * The count is injected into the item's content row
 * (div[class*="TreeView-item-content"]), which is a flex container, so
 * margin-left:auto pushes the count to the right edge.
 */
export function injectTreeCounts(files: FileEntry[]): void {
  if (files.length === 0) return;

  const treeRoot = findFileTree();
  if (!treeRoot) return;

  const { fileMap, folderMap } = buildMaps(files);

  for (const item of Array.from(treeRoot.querySelectorAll<HTMLElement>('[role="treeitem"]'))) {
    if (item.querySelector(`.${TREE_COUNT_CLASS}`)) continue;

    const path = item.id;
    if (!path) continue;

    const stats = fileMap.get(path) ?? folderMap.get(path);
    if (!stats) continue;

    // The content row is the flex div containing the icon and label text.
    // Fall back to the <li> itself if the inner div isn't found.
    const row = item.querySelector<HTMLElement>('[class*="TreeView-item-content"]') ?? item;
    row.appendChild(createCount(stats));
  }
}

export function clearTreeCounts(): void {
  document.querySelectorAll(`.${TREE_COUNT_CLASS}`).forEach((el) => el.remove());
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function buildMaps(files: FileEntry[]): {
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
    add.style.color = "#1a7f37"; // GitHub green
    add.textContent = `+${stats.added}`;
    wrap.appendChild(add);
  }
  if (stats.removed > 0) {
    const rm = document.createElement("span");
    rm.style.color = "#cf222e"; // GitHub red
    rm.textContent = `−${stats.removed}`;
    wrap.appendChild(rm);
  }

  return wrap;
}
