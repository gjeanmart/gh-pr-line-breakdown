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
│   ├── badges.ts           # injects colored category pill badges into file diff headers
│   ├── file_tree.ts        # injects +N -N line counts into the PR file tree sidebar
│   ├── matcher.ts          # wildcard category matching (custom globMatch, no deps)
│   ├── config.ts           # Category/Config types, defaults, chrome.storage helpers
│   ├── github_api.ts       # fetches PR files via GitHub REST API (paginated)
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.ts        # breakdown view + show/hide empty toggle + "Open Options" button
│   └── options/
│       ├── options.html
│       ├── options.css     # extracted stylesheet (copied to dist/ by build.mjs)
│       └── options.ts      # category editor + GitHub token field
├── dist/                   # build output — DO NOT edit manually
├── tests/
│   └── matcher.test.ts     # vitest unit tests for matcher logic
├── package.json
├── tsconfig.json
└── vite.config.ts          # vitest config only (build uses build.mjs)
```

---

## Tech stack

- **TypeScript** throughout
- **Vite 5** for bundling (outputs to `dist/`), build driven by `build.mjs`
- **vitest** for unit tests
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
- On failure, `fetchPrFilesFromApi` returns a typed `ApiError` (not `null`) so the widget
  can render a specific message. Mapping: `401` → `auth_required`, `403` with
  `X-RateLimit-Remaining: 0` → `rate_limit`, other `403` / `404` → `not_accessible`,
  `429` → `rate_limit`, network exception → `network`, anything else → `unknown`.

### Widget — hover popup on diffstat

The widget is a hover popup anchored to the native GitHub `+N -N ████` diffstat element.

**Anchor detection** (in order):

1. `document.querySelector('[class*="diffStatesWrap"]')` — the Primer React element
   that wraps the `+610 -3 ████` line (most reliable)
2. Fallback: walk up from `[role="tablist"]`, look for a sibling element containing
   a `.fgColor-success` or `.color-fg-success` span

The shadow host (`div#gh-line-breakdown-host`) is appended to `document.body` with
`position: absolute`. The shadow root contains the `<style>` block and a `.popup` div.
This avoids `overflow: hidden` clipping from ancestor containers and fully isolates
the widget styles from GitHub's page.

**Event listener cleanup**: `AbortController` is used to tear down `mouseenter`/`mouseleave`
listeners on both the anchor and the host whenever the anchor changes (avoids accumulating
duplicate listeners across React re-renders).

**Loading pattern**: when a new PR is detected, `renderLoadingState()` auto-shows the
popup immediately with a spinner (`autoShow: true`). Once the API call completes,
`renderHeaderIcon()` updates the content in-place without auto-showing (`autoShow: false`),
letting hover behaviour take over. On API error, `renderError(kind)` auto-shows the popup
with a contextual red message (also `autoShow: true`).

**Widget layout** (5-column CSS grid per row):
`120px cat-name | 56px cat-files | 1fr bar-track | auto stats | 32px pct`

- Header shows: total lines · total files · +added −removed
- Each row: category name | N files (gray, 11px) | bar | +added −removed (paired in a
  flex container, `min-width: 48px` each for column alignment) | %
- `CategoryStats` includes a `files` counter (incremented per file in `buildBreakdown`)
- Rows with 0 lines get a `row--empty` class and are hidden by default via `.rows.hide-empty .row--empty { display: none; }`.
  A footer toggle link ("Show N empty" / "Hide empty") lets the user reveal them.
  State is tracked in the `hideEmpty` module variable (persists across hover open/close).
  The same pattern is implemented in the extension popup (`popup.ts` / `popup.html`).

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

All three strategies insert the badge immediately before the `button[aria-label*="Viewed"]`
button for consistent positioning. `findHeaderContainer` walks up the DOM to find the
smallest ancestor with exactly one "Viewed" button, scoping badge injection to one file at a
time. `clearBadges()` removes all injected badges when navigating to a new PR.

A 10×10px rounded color swatch (`.cat-dot`) also appears to the left of each category name
in the hover widget and the extension popup.

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

### MutationObserver

Observes `document.body` (not a scoped element) so it fires on every PR tab:
Conversation, Commits, Checks, Files Changed. Debounced 300ms.

SPA navigation is detected by comparing `location.href` before and after each mutation.
When the PR path changes, the API cache is cleared so the new PR's data is fetched.

---

## Build system

`npm run build` runs `node build.mjs`, which performs **two separate Vite builds**:

1. **Content script** → `dist/content_script.js` — IIFE format, fully self-contained
   (~30 kB). Must be IIFE so Chrome can inject it as a standalone script.
2. **Popup + options** → `dist/popup/popup.js`, `dist/options/options.js` — ES modules,
   code-split by Rollup.

Static files (`manifest.json`, `popup.html`, `options.html`, `options.css`) are copied to `dist/`.

`vite.config.ts` is kept minimal — only configures vitest.

---

## Build & local dev

```bash
npm install
npm run build          # outputs to dist/
npm run test           # vitest unit tests (19 tests)
```

To load in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

---

## Releasing a new version

### CI workflow (`.github/workflows/ci.yml`)

Runs on every push to `main` and on every PR:

- `npm ci` → `npm test` → `npm run build`

### Release workflow (`.github/workflows/release.yml`)

Triggered by pushing a `v*` tag. Steps:

1. Run tests
2. Strip `v` prefix from tag → patch `package.json` and `manifest.json` with the semver version
3. `npm run build`
4. `cd dist && zip -r ../gh-pr-line-breakdown-vX.Y.Z.zip .`
5. Create GitHub Release with the zip + auto-generated release notes (`softprops/action-gh-release`)
6. If `CHROME_EXTENSION_ID` secret is set: call the CWS Publish API (OAuth2 token exchange → upload zip → publish)

### How to cut a release

```bash
npm run release X.Y.Z
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
- [ ] Review and polish UI/UX design (widget + options page)
- [ ] Publish to the Chrome Web Store (first manual submission pending)
- [ ] Expand test coverage — more edge cases in `matcher.test.ts`, integration-style tests
- [ ] Manage specific config per repo
- [ ] Add a **show/hide icon per category row** in the widget to filter (show/hide) the matching files in GitHub's Files Changed tab
- [x] Inject **`+N -N` line counts** into GitHub's PR file tree (left sidebar) next to each file and folder (folders show rolled-up totals)
- [ ] **Firefox support** — publish to AMO; use `browser.*` API (WebExtensions) with a polyfill or conditional shim, ship a separate `manifest.firefox.json` (MV2) alongside the existing MV3 manifest, and add a Firefox build pass to `build.mjs`
- [ ] **Category breakdown pills on PR list pages** — inject mini colored category pills on GitHub PR list views (`/pulls`) so reviewers can see the file-type composition of a PR before opening it (requires a lightweight API call per visible PR row, with caching)
- [ ] **LLM integration** — connect to a cloud (OpenAI, Anthropic, etc.) or local (Ollama) LLM to offer AI-assisted review features: PR summary based on category breakdown and file paths, review focus suggestions ("only 12 lines of Main changed — likely a config-only PR"), inline comment proposals, and risk flagging. Token/endpoint configurable in the options Settings tab alongside the GitHub token.
- [ ] **GitHub classic experience support** — the widget anchor detection and badge injection currently target Primer React DOM selectors only (`[class*="diffStatesWrap"]`, `button[aria-label^="Expand all lines"]`, etc.). Add fallback selectors for the classic GitHub UI so the extension works regardless of which experience the user has opted into.
- [ ] **GitLab support** — extend to GitLab MR pages (`gitlab.com` + self-hosted); abstract the host-specific API client and DOM injection behind a provider interface (`GitHubProvider`, `GitLabProvider`) so `content_script.ts` stays provider-agnostic. GitLab REST API: `GET /projects/:id/merge_requests/:iid/changes`.
- [ ] **Gitea support** — extend to Gitea/Forgejo instances (self-hosted); add a `GiteaProvider` using `GET /repos/{owner}/{repo}/pulls/{index}/files`. User configures instance URLs in the Settings tab.

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

---

## Key constraints

- **Do not edit `dist/`** — it is build output
- `matcher.ts` must be **pure** — no DOM or Chrome API dependencies; fully unit-testable
- Content script stays lean — heavy logic lives in `matcher.ts` / `config.ts`
- Do not use `minimatch` — it breaks in browser IIFE bundles. The custom `globMatch`
  in `matcher.ts` handles all patterns used in this project
- Do not use `chrome.storage.sync` for the token — use `chrome.storage.local`
