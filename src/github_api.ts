import type { FileEntry } from "./matcher.js";
import type { GitHubPage } from "./page.js";

export type ApiError = "rate_limit" | "not_accessible" | "auth_required" | "network" | "unknown";
export type ApiResult = { files: FileEntry[] } | { error: ApiError };

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function classifyError(res: Response): ApiError {
  if (res.status === 401) return "auth_required";
  if (res.status === 404) return "not_accessible";
  if (res.status === 429) return "rate_limit";
  if (res.status === 403) {
    return res.headers.get("X-RateLimit-Remaining") === "0" ? "rate_limit" : "not_accessible";
  }
  return "unknown";
}

function mapFiles(raw: Array<{ filename: string; additions: number; deletions: number }>): FileEntry[] {
  return raw.map((f) => ({ filename: f.filename, added: f.additions, removed: f.deletions }));
}

type RawFile = { filename: string; additions: number; deletions: number };

/**
 * Fetch the changed files for a PR or a commit. Takes the parsed page rather than reading
 * window.location, so it is callable (and testable) outside a GitHub tab.
 */
export function fetchFiles(page: GitHubPage, token?: string): Promise<ApiResult> {
  return page.kind === "pr" ? fetchPrFiles(page, token) : fetchCommitFiles(page, token);
}

// PRs paginate at 100 files/page; the 30-page ceiling caps us at 3,000 files.
async function fetchPrFiles(page: GitHubPage, token?: string): Promise<ApiResult> {
  const { owner, repo, ref } = page;
  const headers = buildHeaders(token);
  const files: FileEntry[] = [];

  for (let pageNum = 1; pageNum <= 30; pageNum++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${ref}/files?per_page=100&page=${pageNum}`;
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch {
      return { error: "network" };
    }

    if (!res.ok) return { error: classifyError(res) };

    const batch: RawFile[] = await res.json();
    files.push(...mapFiles(batch));
    if (batch.length < 100) break;
  }

  return { files };
}

// A commit's files come back in the commit payload itself — a single request.
async function fetchCommitFiles(page: GitHubPage, token?: string): Promise<ApiResult> {
  const { owner, repo, ref } = page;
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`;

  let res: Response;
  try {
    res = await fetch(url, { headers: buildHeaders(token) });
  } catch {
    return { error: "network" };
  }

  if (!res.ok) return { error: classifyError(res) };

  const data: { files?: RawFile[] } = await res.json();
  return { files: mapFiles(data.files ?? []) };
}
