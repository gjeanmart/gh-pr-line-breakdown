# gh-pr-line-breakdown — Project Memory

## What this project is
Chrome Extension (Manifest V3) overlaying a hover popup widget on GitHub PR pages.
Categorizes changed lines into configurable buckets via wildcard (glob) patterns.
Widget appears on hover over the native `+N -N ████` diffstat in the PR header.

## Tech stack
- TypeScript, Vite 5, vitest
- `"type": "module"` in package.json (ESM project)
- Custom `globMatch` in matcher.ts (NO minimatch — it breaks in browser IIFE bundles)
- Shadow DOM for widget isolation (no style leakage to/from GitHub's page)

## Build system
- **No `vite build` CLI** — uses a programmatic build script: `build.mjs`
- `npm run build` → `node build.mjs`
- Two separate Vite builds inside `build.mjs`:
  1. Content script → IIFE (lib mode, fully self-contained, ~30 kB)
  2. Popup + options → ES modules (code-split into dist/popup/ and dist/options/)
- Copies to dist/: manifest.json, popup.html, options.html, **options.css**
- `vite.config.ts` is kept minimal (only used by vitest)

## Key files
- [src/config.ts](src/config.ts) — Category/Config types, DEFAULT_CONFIG, loadConfig/saveConfig
- [src/matcher.ts](src/matcher.ts) — Pure functions: globMatch, classifyFile, buildBreakdown
- [src/github_api.ts](src/github_api.ts) — fetchPrFilesFromApi (paginated REST API, up to 3000 files)
- [src/content_script.ts](src/content_script.ts) — API fetch + cache, MutationObserver (300ms debounce)
- [src/widget.ts](src/widget.ts) — Shadow DOM hover popup anchored to diffstat element
- [src/options/options.html](src/options/options.html) + [options.css](src/options/options.css) — options page (separate CSS file)
- [src/options/options.ts](src/options/options.ts) — category editor + GitHub token field
- [src/popup/](src/popup/) — Minimal popup ("Open Options" button)
- [tests/matcher.test.ts](tests/matcher.test.ts) — 19 vitest tests for matcher logic
- [manifest.json](manifest.json) — MV3, matches: `https://github.com/*`, host: github.com + api.github.com

## Architecture — key decisions

### SPA navigation: broad manifest match
- `matches: ["https://github.com/*"]` (not just `/pull/*`) — content script loads on all
  GitHub pages so navigating from PR list → PR via SPA works without a page reload.
- `getPrPath()` guards all logic — no work done outside actual PR pages.

### Data source: GitHub REST API only (no DOM parsing for files)
- `fetchPrFilesFromApi` in `github_api.ts` fetches paginated file list from GitHub API
- Returns `ApiResult` (discriminated union: `{ files }` or `{ error: ApiError }`) — never bare `null` on HTTP errors
- `ApiError` values: `rate_limit` | `not_accessible` | `auth_required` | `network` | `unknown`
- HTTP mapping: 401→auth_required, 403+no-remaining→rate_limit, 403→not_accessible, 404→not_accessible, 429→rate_limit, network throw→network
- Handles lazy-loaded large PRs correctly (DOM only shows visible files)
- Results cached per PR path (`cachedPrPath` / `cachedFiles` / `cachedError`) in `content_script.ts`
- SPA navigation detected via `location.href` comparison in MutationObserver

### Widget: Shadow DOM hover popup
- Shadow host (`div#gh-line-breakdown-host`) on `document.body`, `position: absolute`
- Shadow root contains `<style>` + `<div class="popup">` — fully isolated from GitHub's CSS
- `AbortController` (`listenerController`) tears down mouseenter/mouseleave listeners
  cleanly when the anchor changes (avoids duplicate listeners across React re-renders)
- Anchored to `[class*="diffStatesWrap"]` (Primer React diffstat element)
- Fallback anchor: walk up from `[role="tablist"]`, find sibling with `.fgColor-success`
- `autoShow: true` for loading state (spinner shown immediately on new PR) and error state
- `autoShow: false` for data render (hover to see, no flash on subsequent renders)
- `renderError(kind: ApiError)` shows a red ⚠ message with copy specific to the error kind

### Widget layout (row grid)
- 5-column grid: `120px cat-name | 56px cat-files | 1fr bar-track | auto stats | 32px pct`
- `cat-files` is a **separate grid column** (not inline in cat-name) — prevents truncation for long names like "Generated / Other"
- `stats` is a flex container wrapping `.stat-added` + `.stat-removed` with `gap: 8px`
- `.stat` has `min-width: 48px; text-align: right` for column alignment across rows
- Header totals: lines · files · +added −removed (all in `.totals` flex row)
- `CategoryStats.files` (added to type + `buildBreakdown`) drives both per-row and header file counts

### MutationObserver: always on document.body
- NOT scoped to a specific element — `diff-comparison-viewer-container` only exists
  on the Files Changed tab and gets removed on tab switch, detaching scoped observers
- Debounced 300ms, works on all PR tabs (Conversation, Commits, Checks, Files Changed)

### Storage: split by sensitivity
- `chrome.storage.sync` → category config (syncs across devices — intentional)
- `chrome.storage.local` → GitHub token (on-device only — never synced)

### Security fixes applied
- `escapeAttr` escapes `&` and `<` in addition to `"` and `'`
- Token stored in `local`, not `sync`
- Shadow DOM eliminates CSS injection into GitHub's `document.head`

## Build status
- `npm run build` ✅
- `npm run test` ✅ 19/19 tests passing

## Git remote
- `origin` → `git@github.com:gjeanmart/gh-pr-line-breakdown.git`

## Phases
- Phase 1 (PoC): done
- Phase 2 (MVP): done
- Phase 3 (V1): not started (popup breakdown summary, markdown export)
