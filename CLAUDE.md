# CLAUDE.md — gh-pr-line-breakdown

## What this is

A Chrome Extension (Manifest V3) that overlays a line-count breakdown widget
on GitHub PR pages, categorizing changed lines into configurable buckets
(Tests, Documentation, Generated/Other, Main) based on wildcard file patterns.

---

## Project structure

```
gh-pr-line-breakdown/
├── manifest.json
├── build.mjs               # programmatic Vite build (two passes)
├── src/
│   ├── content_script.ts   # injected on github.com/*/pull/* pages
│   ├── widget.ts           # hover popup rendering (anchored to diffstat)
│   ├── matcher.ts          # wildcard category matching (custom globMatch, no deps)
│   ├── config.ts           # Category/Config types, defaults, chrome.storage helpers
│   ├── github_api.ts       # fetches PR files via GitHub REST API (paginated)
│   ├── popup/
│   │   ├── popup.html
│   │   └── popup.ts        # "Open Options" button
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
letting hover behaviour take over.

**Anchor change detection**: GitHub's React re-renders can replace the anchor DOM node.
The `currentAnchor` module variable tracks the last known anchor; if a new one is found,
the event listeners are rebound via `AbortController`.

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

## Phases

### Phase 1 — PoC (done)

Prove DOM parsing works. Hardcoded categories, console.log output only.

### Phase 2 — MVP (done)

Wildcard matching, options page, `chrome.storage.sync`, hover widget,
MutationObserver, GitHub API for file data.

### Phase 3 — V1 (not started)

- [ ] Review and polish UI/UX design (widget + options page)
- [ ] Add **file change count** per category alongside the line counts
- [x] Move **Main** category to the top of the default order (or make order user-configurable)
- [ ] CI/CD pipeline (GitHub Actions: build + test on every push)
- [ ] Publish to the Chrome Web Store
- [ ] Expand test coverage — more edge cases in `matcher.test.ts`, integration-style tests

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
