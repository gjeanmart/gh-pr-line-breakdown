# GitHub PR Line Breakdown

A Chrome extension that shows a line-count breakdown widget on GitHub PR pages, categorizing changed lines into configurable buckets (Tests, Documentation, Generated, Main) based on glob patterns.

![Screenshot](docs/screenshot.png)

## How it works

The extension fetches the list of changed files from the GitHub REST API and classifies each file against your configured categories using glob patterns. The results appear as a hover popup anchored to the native `+N -N ████` diffstat shown in the PR header — visible on every PR tab (Conversation, Commits, Checks, Files Changed).

The popup header shows the total line and file counts across all categories. Each category row shows its file count, a proportional bar chart, added/removed line counts, and a percentage of total lines changed.

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

If the extension can't load PR data it shows a contextual error message in the popup:

| Situation                                     | Message                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------- |
| Rate limit hit (no token, or quota exhausted) | "Rate limit reached — add a GitHub token in the options to increase your quota" |
| Private repo / token missing `repo` scope     | "Repository not accessible — a GitHub token with repo scope may be required"    |
| Invalid or expired token                      | "Authentication required — add a GitHub token in the options"                   |
| Network failure                               | "Network error — check your connection and try again"                           |
| Other API error                               | "Failed to load PR data"                                                        |

## Categories

Categories are evaluated in order — the first matching pattern wins. The category marked as fallback catches everything not matched above.

Default categories:

| Category              | Matches                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| **Main** (fallback)   | Everything else                                                                                      |
| **Tests**             | `*.spec.ts`, `*.test.ts`, `*.spec.tsx`, `*.test.tsx`, `__tests__/**`, `test_*.py`, `*_test.py`, etc. |
| **Documentation**     | `*.md`, `*.rst`, `*.svg`, `docs/**`, images, diagrams                                                |
| **Generated / Other** | Lock files, `*.snap`, `dist/**`, `build/**`, `.next/**`, Python bytecode                             |

### Customizing categories

Open the extension options page to add, remove, reorder (drag and drop), or edit the glob patterns of any category (one pattern per line). Changes take effect immediately on the next PR page load.

## Build

```bash
npm install
npm run build   # outputs to dist/
npm run test    # unit tests (vitest)
```

## Releasing a new version

Releases are fully automated via GitHub Actions on version tags.

### Steps

1. Make sure all changes are merged into `main` and CI is green
2. Bump the version in `package.json` and `manifest.json` to the new version (e.g. `1.1.0`)
3. Commit and push:
   ```bash
   git add package.json manifest.json
   git commit -m "chore: bump version to v1.1.0"
   git push origin main
   ```
4. Tag and push:
   ```bash
   git tag v1.1.0
   git push origin v1.1.0
   ```

The `release` GitHub Actions workflow will then automatically:

- Run tests
- Sync the version from the tag into `package.json` and `manifest.json`
- Build the extension
- Package `dist/` as `gh-pr-line-breakdown-v1.1.0.zip`
- Create a GitHub Release with the zip attached and auto-generated release notes
- Publish to the Chrome Web Store (if the required secrets are configured — see below)

### Chrome Web Store secrets

To enable automated CWS publishing, add these secrets to the GitHub repo
(**Settings → Secrets and variables → Actions**):

| Secret                 | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `CHROME_EXTENSION_ID`  | The extension ID from the CWS dashboard URL     |
| `CHROME_CLIENT_ID`     | OAuth 2.0 client ID from Google Cloud Console   |
| `CHROME_CLIENT_SECRET` | OAuth 2.0 client secret                         |
| `CHROME_REFRESH_TOKEN` | Refresh token obtained via the OAuth playground |

If these secrets are not set, the release zip is still created and attached to the GitHub Release — you can upload it manually to the CWS dashboard.

> **Note:** The first version must always be submitted manually through the
> [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
> to create the listing, fill in the store metadata (description, screenshots, privacy policy),
> and pass the initial review.

## Tech stack

- TypeScript, Vite 5, vitest
- Vanilla DOM (no UI framework)
- Custom glob matcher (no runtime dependencies in the content script)
- Shadow DOM for widget isolation (styles fully isolated from GitHub's page)
- `chrome.storage.sync` for category config, `chrome.storage.local` for the token
