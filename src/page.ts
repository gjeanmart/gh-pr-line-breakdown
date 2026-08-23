// Which GitHub page are we on? Pure string parsing — the one place that knows the URL
// shapes this extension supports, shared by the content script, the GitHub API client and
// the extension popup (which previously had its own, PR-only pattern and so claimed
// "navigate to a GitHub PR" while sitting on a supported commit page).

export type PageKind = "pr" | "commit";

export type GitHubPage = {
  kind: PageKind;
  owner: string;
  repo: string;
  /** PR number for "pr", commit SHA for "commit". */
  ref: string;
  /** Canonical page path, used as the API cache key. */
  path: string;
};

// Both allow trailing segments: /files, /commits, /checks and #anchors all belong to the
// same PR or commit as far as we are concerned.
const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const COMMIT_PATH = /^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})/i;

export function parseGitHubPage(pathname: string): GitHubPage | null {
  const pr = pathname.match(PR_PATH);
  if (pr) {
    const [path, owner, repo, ref] = pr;
    return { kind: "pr", owner, repo, ref, path };
  }

  const commit = pathname.match(COMMIT_PATH);
  if (commit) {
    const [path, owner, repo, ref] = commit;
    return { kind: "commit", owner, repo, ref, path };
  }

  return null;
}

/** Same thing from a full URL — what the popup has, via chrome.tabs. */
export function parseGitHubUrl(url: string): GitHubPage | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com") return null;
  return parseGitHubPage(parsed.pathname);
}
