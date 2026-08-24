# CLAUDE.md — gh-pr-line-breakdown

## What this is

A Chrome Extension (Manifest V3) that overlays a line-count breakdown widget
on GitHub PR pages, categorizing changed lines into configurable buckets
(Tests, Documentation, Generated/Other, CI/CD, Infrastructure, Config, Database,
Styles, Main) based on wildcard file patterns.

---

## Project structure

```
gh-pr-line-breakdown/
├── manifest.json
├── build.mjs               # programmatic Vite build (two passes)
├── src/
│   ├── content_script.ts   # injected on github.com/*/pull/* pages
│   ├── widget.ts           # hover popup rendering (anchored to diffstat)
│   ├── anchor.ts           # locates GitHub's +N −N diffstat element (DOM-only, testable)
│   ├── collapse.ts         # drives GitHub's own per-file collapse control
│   ├── color.ts            # category colour safety + readable badge text (pure)
│   ├── html.ts             # escapeHtml / escapeAttr, shared by all three UIs (pure)
│   ├── summary.ts          # totals, percentages, bar widths, markdown export (pure)
│   ├── background.ts       # service worker: opens the options page on request
│   ├── badges.ts           # injects colored category pill badges into file diff headers
│   ├── file_tree.ts        # injects +N -N line counts into the PR file tree sidebar
│   ├── matcher.ts          # wildcard category matching (custom globMatch, no deps)
│   ├── config.ts           # Category/Config types, defaults, chrome.storage helpers
│   ├── github_api.ts       # fetches PR / commit files via GitHub REST API (paginated)
│   ├── page.ts             # which GitHub page are we on (pure URL parsing)
│   ├── theme.css           # shared palette for the popup + options pages
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.ts        # breakdown view + show/hide empty toggle + "Open Options" button
│   └── options/
│       ├── options.html
│       ├── options.css     # extracted stylesheet (copied to dist/ by build.mjs)
│       └── options.ts      # category editor + GitHub token field
├── dist/                   # build output — DO NOT edit manually
├── tests/
│   ├── matcher.test.ts     # vitest unit tests for matcher logic
│   ├── anchor.test.ts      # jsdom tests for diffstat anchor detection
│   ├── widget.test.ts      # jsdom tests for popup hover behaviour
│   ├── collapse.test.ts    # jsdom tests for the collapse control
│   ├── page.test.ts        # URL parsing (pure, no DOM)
│   ├── filter.test.ts      # end-to-end: badges + collapse over captured markup
│   ├── color.test.ts       # colour sanitising + contrast (pure)
│   ├── github_api.test.ts  # pagination, truncation, quota, error mapping (stubbed fetch)
│   ├── config.test.ts      # fallback normalisation + import validation (pure)
│   ├── summary.test.ts     # breakdown arithmetic, markdown, tree rollup, escaping (pure)
│   ├── file_tree.test.ts   # jsdom tests for the sidebar counts
│   └── fixtures/           # captured GitHub markup (PR header, commit header)
├── package.json
├── tsconfig.json
└── vite.config.ts          # vitest config only (build uses build.mjs)
```

---

## Tech stack

- **pnpm** as the package manager, pinned via `packageManager`. Chosen for one feature above
  all: pnpm 10 refuses to run a dependency's install scripts unless it is named in
  `pnpm.onlyBuiltDependencies`. Only `esbuild` is listed, because it is the only dependency
  here with an install script and needs it to link its platform binary. npm's equivalent
  (`ignore-scripts`) is all-or-nothing, and turning it on would break esbuild.
- **TypeScript** throughout
- **Vite 5** for bundling (outputs to `dist/`), build driven by `build.mjs`
- **vitest** for unit tests — `jsdom` for the DOM-level anchor tests, opted into
  per file with `// @vitest-environment jsdom`; everything else runs in `node`
- **Custom `globMatch`** in `matcher.ts` — replaces minimatch (minimatch is broken
  in browser IIFE bundles; the custom parser handles all needed patterns correctly)
- No UI framework — vanilla DOM for widget and options page
- **Shadow DOM** for widget isolation — styles injected into a shadow root, fully
  isolated from GitHub's page styles (no `glb-*` prefix hacks needed)
- `chrome.storage.sync` for category config (syncs across devices)
- `chrome.storage.local` for the GitHub token (on-device only — never synced)

---

## Category config schema

Categories are evaluated **in order**. The first matching category wins.
A category with `"fallback": true` catches everything not matched above it.

```ts
type Category = {
  name: string;
  color?: string; // hex color for the pill badge and color swatch (default: #8c959f)
  patterns: string[]; // glob patterns (custom globMatch, minimatch-compatible syntax)
  fallback?: boolean; // if true, matches anything not matched above
};
```

Default config (in `src/config.ts`):

- **Tests** — `*.spec.ts`, `*.test.ts`, `*.spec.tsx`, `*.test.tsx`, `*.spec.js`,
  `*.test.js`, `*.spec.jsx`, `*.test.jsx`, `__tests__/**`, `__mocks__/**`,
  `test_*.py`, `*_test.py`, `tests/**/*.py`, `conftest.py`
- **Documentation** — `*.md`, `*.mdx`, `*.rst`, `*.txt`, images, diagrams, `docs/**`
- **Generated / Other** — lock files, `*.snap`, `dist/**`, `build/**`, `.next/**`,
  Python bytecode
- **CI/CD** — `.github/workflows/**`, `.circleci/**`, `Dockerfile*`,
  `docker-compose*`, `.travis.yml`, `.drone.yml`, `Jenkinsfile`
- **Infrastructure** — `*.tf`, `*.tfvars`, `terraform/**`, `k8s/**`,
  `kubernetes/**`, `helm/**`, `charts/**`
- **Config** — `.eslintrc*`, `.prettierrc*`, `tsconfig*.json`, `vite.config.*`,
  `.editorconfig`, `.nvmrc`, `renovate.json`, `.dependabot/**`
- **Database** — `migrations/**`, `db/migrate/**`, `seeds/**`, `fixtures/**`, `*.sql`
- **Styles** — `*.css`, `*.scss`, `*.sass`, `*.less`, `styles/**`, `themes/**`
- **Main** (fallback) — everything else

---

## How it works

### Data source — GitHub REST API

File data is fetched from the GitHub API (`GET /repos/{owner}/{repo}/pulls/{pull}/files`),
paginated at 100 files/page (up to 3,000 files). This is more reliable than DOM
scraping, which misses lazily-loaded files on large PRs.

- Auth token is optional: without it, public repos are limited to 60 API calls/hour.
  Private repos require a `repo`-scoped token.
- Results are **cached per PR path** (`cachedPrPath` / `cachedFiles`). Navigating to a
  different PR invalidates the cache.
- On failure, `fetchFiles` returns a typed `ApiError` so the widget
  can render a specific message. Mapping: `401` → `auth_required`, `403` with
  `X-RateLimit-Remaining: 0` → `rate_limit`, other `403` / `404` → `not_accessible`,
  `429` → `rate_limit`, network exception → `network`, anything else → `unknown`.

### Page detection — `src/page.ts`

`parseGitHubPage(pathname)` / `parseGitHubUrl(url)` return `{ kind, owner, repo, ref, path }`
for the two supported page types and `null` for everything else. Pure string parsing, so it
is unit tested without a DOM.

- `kind: "pr" | "commit"` decides which API endpoint `fetchFiles` calls
- `path` is the canonical page path (`/owner/repo/pull/12`), used as the API cache key — all
  of a PR's tabs (`/files`, `/commits`, `/checks`) collapse to the same key
- `parseGitHubUrl` additionally checks the host, and is what the **popup** uses, since it
  only has the tab URL. It used to carry its own PR-only regex and so told the user to
  "navigate to a GitHub PR" while sitting on a supported commit page.

`fetchFiles(page, token)` takes the parsed page rather than reading `window.location`, which
keeps the API client callable outside a GitHub tab.

### Widget — hover popup on diffstat

The widget is a hover popup anchored to the native GitHub `+N -N ████` diffstat element.

**Anchor detection** — `src/anchor.ts`

Kept in its own DOM-only module (no chrome APIs, no widget state) so it can be unit tested
against captured GitHub markup — see `tests/anchor.test.ts` and `tests/fixtures/`.

GitHub renders the `+610 -3 ████` chip with its `DiffStats` Primer React component — on PR
headers, commit headers and once per file. That component has **no stable CSS-module class**
(the old `DiffStates-module__diffStatesWrap` wrapper was removed), so detection hooks the two
contracts that survive: the `data-testid="<kind> diffstat"` squares and the `sr-only`
"Lines changed:" label.

```html
<div class="d-flex flex-items-center gap-1">     <!-- the chip — our anchor -->
  <span class="f6 fgColor-success text-bold">+610</span>
  <span class="f6 fgColor-danger text-bold">-3</span>
  <span class="sr-only">Lines changed: 610 additions & 3 deletions</span>
  <div class="d-flex">                           <!-- DiffSquares -->
    <div data-testid="addition diffstat"></div>   <!-- 5 squares -->
  </div>
</div>
```

Order of attempts:

1. `[class*="diffStatesWrap"]` — legacy wrapper, still present on older GitHub Enterprise
2. A diffstat square (or the `sr-only` label when `hideSquares` is set) found **inside a
   header scope**, so a per-file diffstat is never picked: `[class*="rightContentWrapper"]`
   (PR header, `float: right` slot), `[data-component="PH_Navigation"]`,
   `[class*="StickyPullRequestHeader"]`, `[class*="commitFilesChangedContainer"]`
   (commit header), `[class*="ilesChangedHeading"]`
3. The same search document-wide, skipping per-file and file-tree containers
   (`[role="treeitem"]`, `[class*="TreeView"]`, `[class*="DiffFileHeader"]`,
   `[class*="diff-file-header"]`, `[class*="diffTargetable"]`, `.file-header`)
4. Fallback: walk up from the PR tab nav — `[role="tablist"]` is gone, the nav is now
   `nav[aria-label="Pull request navigation tabs"]` / `[class*="TabNav"]` — looking for a
   sibling containing a `.fgColor-success` or `.color-fg-success` span

From a square we climb to the chip: the closest ancestor whose **direct children** include
the `sr-only` label or a `.fgColor-success` span.

Every candidate passes through `isVisible()`, which walks computed styles for
`display: none` / `visibility: hidden`. GitHub ships duplicate header slots and hides the
inactive one with a container query, so an invisible clone would otherwise win the query.
`getClientRects()` would be more precise in a browser but always returns nothing under
jsdom, which has no layout engine — that would make the module untestable.

The shadow host (`div#gh-line-breakdown-host`) is appended to `document.body` with
`position: absolute`. `ensureShadow()` only reuses its cached root while that root's host is
still the element in the document — otherwise anything that replaced the page body would
leave every later render writing into a detached tree, permanently. The shadow root contains the `<style>` block and a `.popup` div.
This avoids `overflow: hidden` clipping from ancestor containers and fully isolates
the widget styles from GitHub's page.

**Event listener cleanup**: `AbortController` is used to tear down `mouseenter`/`mouseleave`
listeners on both the anchor and the host whenever the anchor changes (avoids accumulating
duplicate listeners across React re-renders).

**Hover-only**: the popup is opened by hover and nothing else. `renderLoadingState()`,
`renderHeaderIcon()` and `renderError(kind)` only write content into the shadow root — they
never change `display`. Auto-showing on load used to pop the widget open every time you
navigated from a PR list into a PR, which is exactly when nobody asked for it.

Because of that, a failure needs a signal outside the popup: `renderError` puts a 7px red dot
(`.gh-breakdown-alert`, in GitHub's own danger colour) on the diffstat chip, and `setContent`
re-applies it on every render since React replaces that chip often. `renderLoadingState` and
`renderHeaderIcon` clear it.

While the popup is open, replacing its content re-runs `positionHost()` so the box stays
anchored as it changes height (loading spinner -> full row list).

**Widget layout** (6-column CSS grid per row):
`120px cat-name | 56px cat-files | 1fr bar-track | auto stats | 32px pct | 20px eye-toggle`

- Header shows: total lines · total files · +added −removed
- Each row: category name | N files (gray, 11px) | bar | +added −removed (paired in a
  flex container, `min-width: 48px` each for column alignment) | % | eye icon button
- `CategoryStats` includes a `files` counter (incremented per file in `buildBreakdown`)
- Rows with 0 lines get a `row--empty` class and are hidden by default via `.rows.hide-empty .row--empty { display: none; }`.
  A footer toggle link ("Show N empty" / "Hide empty") lets the user reveal them.
  State is tracked in the `hideEmpty` module variable (persists across hover open/close).
  The same pattern is implemented in the extension popup (`popup.ts` / `popup.html`).

**Category filter (eye icon)**:
- Each row has a `.cat-toggle` button (eye icon, 20px column). Default: gray, 50% opacity.
  Active/filtered state: red eye-slash icon at full opacity.
- Click toggles the category in `hiddenCategories: Set<string>` (module-level, persists
  across hover open/close like `hideEmpty`). On click, `onToggleCategory(name, visible)`
  callback is invoked — wired in `content_script.ts` to call `setFilesVisible()`.
- `getHiddenCategories()` and `resetCategoryFilter()` are exported so `content_script.ts`
  can re-apply filters after every DOM refresh and clear them on PR navigation.

**Anchor change detection**: GitHub's React re-renders can replace the anchor DOM node.
The `currentAnchor` module variable tracks the last known anchor; if a new one is found,
the event listeners are rebound via `AbortController`.

### Category color badges — `src/badges.ts`

`injectBadges(files, categories)` is called after each API fetch and injects a colored pill
badge (category name on a solid background) into every file diff header on the Files Changed tab.
Three strategies cover GitHub's different header structures:

1. **Strategy 1** — `button[aria-label^="Expand all lines: {path}"]`: path is in the aria-label.
   Used for files that have hidden context lines (partial diffs).
2. **Strategy 2** — `a[href*="/blob/"]`: path extracted from the blob URL via regex
   `/\/blob\/[^/]+\/(.+?)(?:[?#].*)?$/`. Used for files whose header contains a full blob URL.
3. **Strategy 3** — `a[href^="#diff-"]`: GitHub computes the diff anchor as `#diff-{sha256(path)}`.
   For files with neither an expand button nor a full blob URL (e.g. entirely new files),
   all file paths are hashed with `crypto.subtle.digest('SHA-256', ...)` and matched against
   these anchors. This makes `injectBadges` async.

Strategy 3's hashing is **lazy**: it only runs when there is an unresolved `#diff-` anchor
left after strategies 1 and 2, which on most pages means never.

`findHeaderContainer` walks up from the matched element looking for the smallest ancestor
with exactly one "Viewed" button, falling back to an ancestor whose class matches
`diff-file-header` / `DiffFileHeader` (commit pages have no "Viewed" buttons).

⚠️ **That fallback usually lands on `DiffFileHeader-module__file-path-section`, not the whole
header row** — the class test matches any `DiffFileHeader-module__*` class, and the path
section is hit first. So the element in `fileHeaderMap` is often an inner section of the
header, and `insertBadge` then places the badge next to the file name rather than before the
"Viewed" button. That is where the badges actually render today, and it looks fine — but
anything that needs a *sibling* of the path section (the collapse control does) must climb
out of it. Do not assume `fileHeaderMap` holds the full header row.

`clearBadges()` removes all injected badges when navigating to a new PR.

A 10×10px rounded color swatch (`.cat-dot`) also appears to the left of each category name
in the hover widget and the extension popup.

**Category filter / collapse** (`setFilesVisible`, `fileHeaderMap`, `src/collapse.ts`):

Each strategy also stores the resolved `headerContainer` in `fileHeaderMap: Map<string, HTMLElement>`
(filename → header element). This map drives the category filter: when the user clicks an eye
icon in the widget, `setFilesVisible(filenames, false)` collapses the matching file diffs.

Collapsing **drives GitHub's own collapse control** rather than hiding DOM ourselves — the
chevron IconButton present in every file header, on PR and commit pages alike:

```html
<button aria-label="Collapse file"><svg class="octicon octicon-chevron-down"></svg></button>
<button aria-label="Expand file">  <svg class="octicon octicon-chevron-right"></svg></button>
```

`findCollapseToggle` checks the **icon class before the label**: the icon is language
independent, and Primer sometimes moves the accessible name into an `aria-labelledby`
tooltip instead of `aria-label`.

It also **climbs**: starting from the element it was handed (see the warning above — usually
the file-path section, whose subtree does not contain the chevron), it walks up to 4 levels
until a scope contains exactly one control. Zero means keep climbing; more than one means it
has reached a container holding several files, and it gives up rather than collapse the
wrong one. Shipping this without the climb is what broke the eye icon on both page types in
v0.1.6-dev — every synthetic unit test passed, because they were written against markup
where the control sat inside the header element.

Why not hide the diff body ourselves (what this used to do): a file whose body is
`display:none` is not the same thing as a *collapsed* file to GitHub's stylesheet — the
header lost its bottom border — and the hand-rolled ancestor walk (`diffTargetable` on PR
pages, "first ancestor whose parent has >1 children" on commit pages) never worked on
commit pages at all.

`collapseFile` returns `true` only when it actually clicked, so `filteredFiles: Set<string>`
holds exactly the files *we* collapsed and the filter never expands a file the user (or
GitHub, for large diffs) had already collapsed. `setFilesVisible` also skips files already
in `filteredFiles`, so re-applying an active filter after a DOM refresh does not slam shut
a file the user deliberately expanded inside a hidden category.

### File tree line counts — `src/file_tree.ts`

`injectTreeCounts(files)` is called (synchronously) after each API fetch and injects `+N −N`
line counts next to every item in GitHub's PR file tree sidebar (Files Changed tab).

**How paths are resolved**: GitHub's Primer React TreeView sets `id="full/path/to/file"`
on every `[role="treeitem"]` `<li>` — both for files and folders. This allows direct O(1)
`Map.get(id)` lookup with no hashing required.

**Folder rollup**: `buildMaps()` accumulates each file's `added`/`removed` counts into
every ancestor folder path (e.g. `src/foo/bar.ts` contributes to `src/foo` and `src`),
building a `folderMap` alongside the flat `fileMap`.

**Injection point**: counts are appended to the `div[class*="TreeView-item-content"]`
inside each `<li>` — that's the flex row containing the icon and label. `margin-left: auto`
pushes the count to the right edge of the row.

`clearTreeCounts()` removes all injected spans when navigating to a new PR.

### The widget's context object

`renderLoadingState`, `renderHeaderIcon` and `renderError` each take a `WidgetContext` rather
than a parameter list, which had reached four and was still growing:

```ts
type WidgetContext = {
  truncated?: boolean;              // the API capped the file list
  rate?: RateLimit | null;          // what the API last said about our quota
  hasToken?: boolean;               // decides whether quota is worth mentioning
  onOpenSettings?: () => void;      // content script owns the extension APIs
  onToggleCategory?: (name: string, visible: boolean) => void;
};
```

Callbacks live in the context because `widget.ts` deliberately touches no `chrome.*` API — it
stays DOM-only and therefore testable under jsdom.

### Rate limit surfacing

Every GitHub response carries `X-RateLimit-Remaining` / `-Limit` / `-Reset`;
`github_api.ts` returns them as `RateLimit` from successful **and** failed requests, since a
rate-limited 403 is exactly when the reset time matters.

There are two different jobs here, and they belong in different places:

- **A warning**, in the widget footer and the popup: shown only when fewer than 15 calls
  remain, whether or not a token is set — being down to 15 of 5,000 is worse news than 15 of
  60. Only the "add a token" suffix is conditional on not having one.
- **A readout**, in the options page: `fetchRateLimit()` asks `GET /rate_limit`, the one
  endpoint that does not count against the limit, so the number can be shown on load and
  again after saving a token — watching the ceiling jump from 60 to 5,000 is the clearest
  confirmation that the token you just pasted works. It also needs no PR open, unlike reading
  the headers off a files request.
- A `rate_limit` error appends the reset time.
- The three token-fixable errors (`rate_limit`, `auth_required`, `not_accessible`) render a
  button to the options page, labelled "Add a token" or "Check your token" depending on
  `hasToken` — being sent to a field you already filled in is its own dead end.

### Pinning and copying

Clicking the anchor toggles `pinned`; a pinned popup ignores `mouseleave` and takes an accent
border, and Escape releases it. The anchor gets a `title` so the interaction is discoverable.
Both the pinned class and the copy button are re-applied after every render, since
`setContent` replaces the popup's contents wholesale.

`toMarkdown()` in `summary.ts` renders non-empty categories plus a bold total row, and appends
a note when the file list was capped. Clipboard writes need a focused document, so the button
reports "Copy failed" rather than failing silently.

### Skipping work there is none of

Three cheap exits, all added once the pass itself was cheap enough that the sweeps dominated:

- `injectBadges` returns immediately when `fileHeaderMap` covers every file **and** the page
  already has that many badges — one query instead of four document sweeps and a hash pass.
  Both conditions matter: badges prove the page is annotated, the map proves we still know
  which header belongs to which file. A re-rendered header takes our badge with it, so the
  count drops and the next pass does the work.
- `injectTreeCounts` returns when every tree row already carries a count.
- The `MutationObserver` callback still detects SPA navigation on every page, but only
  schedules a pass when `parseGitHubPage` recognises the URL — a dashboard no longer wakes a
  timer every 300 ms to discover there is nothing to annotate.

### Theming

Two different mechanisms, because the surfaces live in two different worlds.

**Injected into a GitHub page** — the widget, the header badges, the tree counts — read
**GitHub's own theme variables**, so they follow whatever theme the reader picked, dimmed and
high-contrast variants included, with no palette of our own to keep in sync:

```css
background: var(--bgColor-default, var(--color-canvas-default, #ffffff));
color:      var(--fgColor-muted,   var(--color-fg-muted,       #656d76));
```

The chain is deliberate: current Primer name, then the pre-rename name (still current on older
GitHub Enterprise), then the literal we used before — so a rename degrades to today's
appearance rather than to nothing. Custom properties **inherit through a shadow boundary** and
are **not** reset by `all: initial`, which is why this works inside the widget's shadow root.

**The extension's own pages** — popup and options — have no host to inherit from, so
`src/theme.css` carries the palette: GitHub's light and dark values as tokens, one file,
linked by both HTML pages and copied to `dist/` by `build.mjs`. `options.css` and the
`<style>` block in `popup.html` reference tokens only.

Two tokens are deliberately theme-invariant: `--fg-on-emphasis` (white text on a saturated
button, never on the page) and the toast, which uses `--fg` as background and `--bg` as text
so it inverts with the theme on purpose.

**Badge text** is not part of either palette — it is computed. `readableTextColor()` in
`color.ts` picks black or white by WCAG contrast against the badge colour, because a pale
category colour used to render white-on-near-white. Two defaults come out dark rather than
white — Generated / Other and CI/CD — and `color.test.ts` pins the whole mapping.

**Category colours are sanitised.** `safeCssColor()` admits hex and nothing else. Colours
reach four DOM sites (badge inline style, widget swatch, popup swatch, options input value)
and an imported config file could otherwise smuggle in a value that closes the attribute or
appends declarations. The options page's colour input only ever produces `#rrggbb`, so
nothing legitimate is refused.

### Reacting to settings changes

`chrome.storage.onChanged` in the content script re-reads the config and restarts the page's
annotations, so saving in the options page no longer requires reloading every GitHub tab.

- categories changed → re-render only
- token changed → also drop the API cache, since a new token can unlock a repo that just failed
- either way, `restoreFilteredFiles()` expands whatever the filter had collapsed first —
  badges carry the old names and colours, and the filter may refer to categories that no
  longer exist

### Performance notes

The content script re-runs its whole pass after every settled batch of DOM mutations, so
per-pass cost matters. Three caches keep it cheap:

| Cache | Where | Why |
| --- | --- | --- |
| Compiled globs, by pattern | `matcher.ts` `regexCache` | classifying 3,000 files against 84 patterns compiled ~250k identical RegExps per pass |
| Classification, by category-array identity then filename | `matcher.ts` `classifyCache` | `buildBreakdown`, `buildFilesByCategory` and `injectBadges` each classify the same list |
| SHA-256 diff hashes, by file-list identity | `badges.ts` `hashMapCache` | strategy 3 hashes every path in the PR |

Measured on a synthetic 3,000-file PR with the default categories: **248 ms → 16 ms per
pass** (15x), cold cache each pass. That time was being spent on the page's main thread.

Both `matcher.ts` caches key on **identity**, so a fresh `loadConfig()` result gets a fresh
cache. Mutating a category's `patterns` array in place would serve stale results — call
`resetMatcherCaches()` if you ever need that.

`injectBadges` and `injectTreeCounts` return how many elements they injected. When that is
non-zero the content script calls `observer.takeRecords()` to discard the mutation records
its own writes just produced, which otherwise schedule another pass that finds nothing to
do. Real GitHub mutations queued in the same window are discarded too — acceptable, since
its lazy rendering always follows up with more.

### MutationObserver

Observes `document.body` (not a scoped element) so it fires on every PR tab:
Conversation, Commits, Checks, Files Changed. Debounced 300ms.

SPA navigation is detected by comparing `location.href` before and after each mutation.
When the PR path changes, the API cache is cleared so the new PR's data is fetched.

---

## Build system

`pnpm run build` runs `node build.mjs`, which performs **three separate Vite builds**:

1. **Content script** → `dist/content_script.js` — IIFE format, fully self-contained
   (~31 kB). Must be IIFE so Chrome can inject it as a standalone script.
2. **Service worker** → `dist/background.js` — IIFE, tiny. Its only job is answering
   `{ type: "openOptions" }`, since `chrome.runtime.openOptionsPage` is not available to
   content scripts and the widget needs to offer it.
3. **Popup + options** → `dist/popup/popup.js`, `dist/options/options.js` — ES modules,
   code-split by Rollup.

Static files (`manifest.json`, `popup.html`, `options.html`, `options.css`) are copied to `dist/`.

`vite.config.ts` is kept minimal — only configures vitest.

---

## Build & local dev

```bash
pnpm install
pnpm run build         # outputs to dist/
pnpm test              # vitest unit tests (170 tests)
```

To load in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

---

## Releasing a new version

### CI workflow (`.github/workflows/ci.yml`)

Runs on every push to `main` and on every PR:

- `pnpm install --frozen-lockfile` → `pnpm audit` → typecheck → `pnpm test` → `pnpm run build`

### Release workflow (`.github/workflows/release.yml`)

Triggered by pushing a `v*` tag. Steps:

1. Run tests
2. Strip `v` prefix from tag → patch `package.json` and `manifest.json` with the semver version
3. `pnpm run build`
4. `cd dist && zip -r ../gh-pr-line-breakdown-vX.Y.Z.zip .`
5. Create GitHub Release with the zip + auto-generated release notes (`softprops/action-gh-release`)
6. If `CHROME_EXTENSION_ID` secret is set: call the CWS Publish API (OAuth2 token exchange → upload zip → publish)

### How to cut a release

```bash
pnpm run release X.Y.Z
```

`release.mjs` will: verify a clean working tree → run tests → bump `package.json`
and `manifest.json` → commit → tag `vX.Y.Z` → push the commit and tag to `main`.
Pushing the tag triggers the release workflow above.

### Required GitHub secrets for CWS auto-publish

| Secret                 | Where to get it                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CHROME_EXTENSION_ID`  | CWS Developer Dashboard URL                                                                                                   |
| `CHROME_CLIENT_ID`     | Google Cloud Console → OAuth 2.0 client                                                                                       |
| `CHROME_CLIENT_SECRET` | Google Cloud Console → OAuth 2.0 client                                                                                       |
| `CHROME_REFRESH_TOKEN` | [OAuth Playground](https://developers.google.com/oauthplayground) with scope `https://www.googleapis.com/auth/chromewebstore` |

If secrets are absent the workflow skips the CWS step — the zip is still attached
to the GitHub Release for manual upload.

### First-time CWS publish (manual)

The CWS API can only **update** an existing listing. The first submission must be
done manually:

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Upload the zip, fill in store metadata (description, screenshots, privacy policy, category)
3. Submit for review (can take a few days)
4. Once approved, copy the Extension ID and set up the secrets above

---

## Phases

### Phase 1 — PoC (done)

Prove DOM parsing works. Hardcoded categories, console.log output only.

### Phase 2 — MVP (done)

Wildcard matching, options page, `chrome.storage.sync`, hover widget,
MutationObserver, GitHub API for file data.

### Phase 3 — V1 (not started)

- [x] Add **file change count** per category alongside the line counts
- [x] Move **Main** category to the top of the default order (or make order user-configurable)
- [x] CI/CD pipeline (GitHub Actions: build + test on every push, release on `v*` tags)
- [x] Export and Import
- [x] Show breakdown in the extension popup
- [x] Expand default categories (CI/CD, Infrastructure, Config, Database, Styles)
- [x] Show/hide empty categories toggle in widget and popup
- [x] Category colors — configurable per category; shown as pill badge on file diff headers and as color swatch in widget/popup
- [x] Theme awareness — injected surfaces read GitHub's own theme variables; the popup and
      options pages share `src/theme.css`; badge text picked by WCAG contrast
- [ ] Review and polish UI/UX design (widget + options page)
- [ ] Publish to the Chrome Web Store (first manual submission pending)
- [ ] Expand test coverage — remaining gaps are the folder rollup in `file_tree.ts` and the
      options-page import validator
- [ ] Manage specific config per repo
- [x] Add a **show/hide icon per category row** in the widget to filter (show/hide) the matching files in GitHub's Files Changed tab
- [x] Inject **`+N -N` line counts** into GitHub's PR file tree (left sidebar) next to each file and folder (folders show rolled-up totals)
- [ ] **Firefox support** — publish to AMO; use `browser.*` API (WebExtensions) with a polyfill or conditional shim, ship a separate `manifest.firefox.json` (MV2) alongside the existing MV3 manifest, and add a Firefox build pass to `build.mjs`
- [ ] **Category breakdown pills on PR list pages** — inject mini colored category pills on GitHub PR list views (`/pulls`) so reviewers can see the file-type composition of a PR before opening it (requires a lightweight API call per visible PR row, with caching)
- [ ] **LLM integration** — connect to a cloud (OpenAI, Anthropic, etc.) or local (Ollama) LLM to offer AI-assisted review features: PR summary based on category breakdown and file paths, review focus suggestions ("only 12 lines of Main changed — likely a config-only PR"), inline comment proposals, and risk flagging. Token/endpoint configurable in the options Settings tab alongside the GitHub token.
- [ ] **GitHub classic experience support** — the widget anchor detection and badge injection currently target Primer React DOM selectors only (`[class*="diffStatesWrap"]`, `button[aria-label^="Expand all lines"]`, etc.). Add fallback selectors for the classic GitHub UI so the extension works regardless of which experience the user has opted into.
- [ ] **GitLab support** — extend to GitLab MR pages (`gitlab.com` + self-hosted); abstract the host-specific API client and DOM injection behind a provider interface (`GitHubProvider`, `GitLabProvider`) so `content_script.ts` stays provider-agnostic. GitLab REST API: `GET /projects/:id/merge_requests/:iid/changes`.
- [ ] **Gitea support** — extend to Gitea/Forgejo instances (self-hosted); add a `GiteaProvider` using `GET /repos/{owner}/{repo}/pulls/{index}/files`. User configures instance URLs in the Settings tab.
- [x] **Commit page support** — extend the extension to work on GitHub commit pages (`github.com/{owner}/{repo}/commit/{sha}`); fetch changed files via `GET /repos/{owner}/{repo}/commits/{sha}` and render the same breakdown widget and file badges as on PR pages.

### Known issues

**Coherence**

- [ ] Types are scattered: `Category`/`Config` in `config.ts`, `FileEntry`/`CategoryStats` in
      `matcher.ts`, so `github_api.ts` imports its file type from the matcher.
- [ ] `badges.ts` still holds three jobs — badge injection, the filename → header map, and the
      filter's public API. The map deserves its own module with its contract stated, since two
      other modules depend on exactly what it stores.
- [ ] Two idioms for injected styling: a stylesheet in the widget's shadow root, long
      `cssText` strings in `badges.ts` and `file_tree.ts`.
- [ ] `release.mjs` has no dry run, and fails confusingly when the version already matches the
      target (its bump commit then has nothing to commit).

**Noted, not a bug**

- Renames are classified by their new path only. The API returns `previous_filename`, so a
  file moved from `src/` into `tests/` counts entirely as Tests. Almost always what you want.

Fixed in v0.1.7: the fallback-category trap (normalised on load, save and import), the
stacked toast timer, document-wide sweeps on every pass, the observer scheduling work on
pages we ignore, three copies of `escapeHtml`, duplicated summary arithmetic, and the
untested folder rollup and import validator.

---

## Test fixtures

`tests/fixtures/` holds **captured GitHub markup**, not hand-written approximations:

- `commit_header.html` — the commit total diffstat and both per-file headers from a real
  commit page, complete with the chevron IconButton, `aria-labelledby` tooltips and CSS
  module class names. Only SVG path data is stripped.
- `pr_header.html` — the real PR header structure, with the diffstat chip filled in from the
  `DiffStats` component source (the server ships a loading skeleton there).

Each file documents its own deviations at the top. Keep them that way: an abridged fixture
that drops the element under test is worse than no fixture, because it makes a passing suite
lie. `tests/filter.test.ts` exists specifically to drive badge injection and collapse
*together* over this markup, which is the seam where per-function tests agreed with each
other and disagreed with GitHub.

## DOM debugging

When the extension fails to interact with GitHub's DOM (wrong element selected, collapse
broken, anchor not found, etc.), inspect the live structure with this console snippet.
Run it on the relevant GitHub page (PR or commit, Files Changed tab):

```javascript
// Paste in DevTools console — logs ancestor chain from the first diff file header
const header = document.querySelector('[class*="DiffFileHeader"], [class*="diff-file-header"]');
if (header) {
  let el = header;
  for (let i = 0; i < 15; i++) {
    const cls = typeof el.className === 'string' ? el.className.substring(0, 120) : '(non-string)';
    console.log(`[${i}] ${el.tagName} | children:${el.children.length} | class: ${cls}`);
    if (!el.parentElement) break;
    el = el.parentElement;
  }
} else { console.log('header not found'); }
```

Share the output with Claude so it can identify the correct CSS module class substrings
to use in selectors (e.g. `diffTargetable`, `diffHeaderWrapper`, etc.).

---

## Security decisions

- **Token in `chrome.storage.local`**, not `sync` — prevents the token syncing to
  other Chrome instances (shared/public machines). Categories stay in `sync`.
- **Shadow DOM for the widget** — isolates styles completely; no risk of leaking
  widget CSS to GitHub's page or GitHub's CSS breaking the widget.
- **`escapeAttr` escapes `&` and `<`** in addition to `"` and `'` — prevents XSS
  when category names are injected into `<input value="...">` attributes via `innerHTML`.
- **Content script scope is `https://github.com/*`** (not just `/pull/*`) — necessary
  for SPA navigation from PR list → PR to work. Accept this as a deliberate trade-off.
- **No `tabs` permission.** The popup reads the active tab's URL through `tabs.query`, which
  works without it: host permissions for `github.com` make the URL visible on matching tabs,
  and `tabs.sendMessage` needs host permission rather than `tabs`. On a non-GitHub tab the URL
  is simply absent, which lands on the same "open a pull request or commit" message. What
  `tabs` bought was the install warning *"Read your browsing history"*.
- **The token only ever goes to `api.github.com`.** `apiUrl()` in `github_api.ts` builds every
  request URL and throws if it does not resolve to that origin, so a future mistake in URL
  construction cannot carry the Authorization header somewhere else.
- **Explicit CSP** (`script-src 'self'; object-src 'self'; base-uri 'none'`) — MV3's default is
  already this strict; declaring it means a loosening shows up in a diff.
- **Zero production dependencies.** Nothing is bundled into the content script but our own
  code, so there is no third-party package in a position to read the page or the token.

---

## Key constraints

- **Do not edit `dist/`** — it is build output
- `matcher.ts` must be **pure** — no DOM or Chrome API dependencies; fully unit-testable
- Content script stays lean — heavy logic lives in `matcher.ts` / `config.ts`
- Do not use `minimatch` — it breaks in browser IIFE bundles. The custom `globMatch`
  in `matcher.ts` handles all patterns used in this project
- Do not use `chrome.storage.sync` for the token — use `chrome.storage.local`
