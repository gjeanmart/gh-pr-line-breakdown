# feat: inject +N −N line counts into GitHub PR file tree sidebar

## Summary

- Adds `src/file_tree.ts` with `injectTreeCounts(files)` and `clearTreeCounts()`
- Injects `+N −N` addition/removal counts next to every file and folder in GitHub's PR file tree sidebar (Files Changed tab)
- Folder counts roll up all files underneath them (e.g. `src/` shows the sum of every changed file in the tree)
- Wires into `content_script.ts` alongside the existing `injectBadges` call; `clearTreeCounts` is called on PR navigation

## How it works

GitHub's Primer React TreeView sets `id="full/path/to/file"` on every `[role="treeitem"]` `<li>` — for both files and folders. This allows direct `Map.get(id)` lookup with no SHA-256 hashing or DOM traversal needed.

Folder rollups are computed client-side in `buildMaps()` by accumulating each file's stats into every ancestor path prefix (`src/foo/bar.ts` → `src/foo` + `src`).

Counts are appended to the `div[class*="TreeView-item-content"]` inside each item — the flex row containing the icon and label — so `margin-left: auto` naturally right-aligns them.

## Test plan

- [ ] Load the unpacked extension from `dist/` in Chrome
- [ ] Open any GitHub PR with nested files on the Files Changed tab
- [ ] Verify `+N` (green) and `−N` (red) counts appear next to every file in the tree
- [ ] Verify folder counts equal the sum of all files underneath
- [ ] Navigate to a different PR and verify counts update correctly (no stale data)
- [ ] Navigate away from the PR and back — verify no duplicate counts are injected
- [ ] `npm test` — 19/19 passing
