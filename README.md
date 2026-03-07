# GitHub PR Line Breakdown

A Chrome extension that shows a line-count breakdown widget on GitHub PR pages, categorizing changed lines into configurable buckets (Tests, Documentation, Generated, Main) based on glob patterns.

![Screenshot](docs/screenshot.png)

## How it works

The extension fetches the list of changed files from the GitHub REST API and classifies each file against your configured categories using glob patterns. The results appear as a hover popup anchored to the native `+N -N ████` diffstat shown in the PR header — visible on every PR tab (Conversation, Commits, Checks, Files Changed).

```
+-------------------------------------------------------------------------+
| Line Breakdown                              1,234 lines changed +980 -254|
| Main        ████████████░░░░░░░░  ██████████    +420 -174   (48%)       |
| Tests       ░░░░░░░░░░░░░░░░░░░░  ████████████  +320   -0   (26%)       |
| Docs        ░░░░░░░░░░░░░░░░░░░░  ██            +40    -0    (3%)       |
| Generated   ░░░░░░░░░░░░░░░░░░░░  ██████████    +200  -80   (22%)       |
+-------------------------------------------------------------------------+
```

## Installation

1. Clone this repo and run `npm install && npm run build`
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `dist/` folder

## GitHub Token (optional)

By default the extension makes unauthenticated API calls, which are limited to **60 requests/hour** for public repos. For private repos or heavy usage, add a token:

1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Generate a token with `repo` scope (private repos) or no scope (public repos only)
3. Open the extension options (click the extension icon → **Open Options**) and paste the token

The token is stored only in your browser via `chrome.storage.local` (on-device only, never synced across devices).

## Categories

Categories are evaluated in order — the first matching pattern wins. The category marked as fallback catches everything not matched above.

Default categories:

| Category | Matches |
|---|---|
| **Main** (fallback) | Everything else |
| **Tests** | `*.spec.ts`, `*.test.ts`, `*.spec.tsx`, `*.test.tsx`, `__tests__/**`, `test_*.py`, `*_test.py`, etc. |
| **Documentation** | `*.md`, `*.rst`, `*.svg`, `docs/**`, images, diagrams |
| **Generated / Other** | Lock files, `*.snap`, `dist/**`, `build/**`, `.next/**`, Python bytecode |

### Customizing categories

Open the extension options page to add, remove, reorder (drag and drop), or edit the glob patterns of any category (one pattern per line). Changes take effect immediately on the next PR page load.

## Build

```bash
npm install
npm run build   # outputs to dist/
npm run test    # unit tests (vitest)
```

## Tech stack

- TypeScript, Vite 5, vitest
- Vanilla DOM (no UI framework)
- Custom glob matcher (no runtime dependencies in the content script)
- Shadow DOM for widget isolation (styles fully isolated from GitHub's page)
- `chrome.storage.sync` for category config, `chrome.storage.local` for the token
