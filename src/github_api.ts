import type { FileEntry } from "./matcher.js";
import type { GitHubPage } from "./page.js";

export type ApiError = "rate_limit" | "not_accessible" | "auth_required" | "network" | "unknown";

/** What the API says about our quota. Every response carries it; we used to read it only to
 *  tell a rate-limited 403 from a forbidden one. */
export type RateLimit = {
  remaining: number;
  limit: number;
  /** When the window resets, in ms since the epoch — null if the header was missing. */
  resetAt: number | null;
};
/** `truncated` means the PR has more files than the API will hand over — see MAX_PAGES. */
export type ApiResult =
  | { files: FileEntry[]; truncated?: boolean; rate?: RateLimit }
  | { error: ApiError; rate?: RateLimit };

const API_ORIGIN = "https://api.github.com";

/**
 * Build an API URL, refusing anything that would leave GitHub's API origin.
 *
 * Requests from here carry the user's personal access token in an Authorization header. The
 * owner, repo and ref come from the page URL and are already constrained by page.ts, so this
 * guards against a future mistake rather than a present one — which is when a token leak is
 * cheapest to prevent.
 */
export function apiUrl(path: string): string {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) {
    throw new Error(`refusing to send credentials to ${url.origin}`);
  }
  return url.toString();
}

// 100 files per page, so 30 pages is a hard 3,000-file ceiling.
const PER_PAGE = 100;
const MAX_PAGES = 30;
export const MAX_FILES = PER_PAGE * MAX_PAGES;

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function readRateLimit(res: Response): RateLimit | undefined {
  const remaining = Number(res.headers.get("X-RateLimit-Remaining"));
  const limit = Number(res.headers.get("X-RateLimit-Limit"));
  if (!Number.isFinite(remaining) || !res.headers.get("X-RateLimit-Remaining")) return undefined;

  const reset = Number(res.headers.get("X-RateLimit-Reset"));
  return {
    remaining,
    limit: Number.isFinite(limit) ? limit : 0,
    resetAt: Number.isFinite(reset) && reset > 0 ? reset * 1000 : null,
  };
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

async function fetchPrFiles(page: GitHubPage, token?: string): Promise<ApiResult> {
  const { owner, repo, ref } = page;
  const headers = buildHeaders(token);
  const files: FileEntry[] = [];
  let truncated = false;
  let rate: RateLimit | undefined;

  for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
    let res: Response;
    try {
      const url = apiUrl(`/repos/${owner}/${repo}/pulls/${ref}/files?per_page=${PER_PAGE}&page=${pageNum}`);
      res = await fetch(url, { headers });
    } catch {
      return { error: "network" };
    }

    if (!res.ok) return { error: classifyError(res), rate: readRateLimit(res) };

    rate = readRateLimit(res);

    const batch: RawFile[] = await res.json();
    files.push(...mapFiles(batch));

    if (batch.length < PER_PAGE) break;
    // A full last page means there is more we are not going to ask for
    if (pageNum === MAX_PAGES) truncated = true;
  }

  return truncated ? { files, truncated, rate } : { files, rate };
}

// A commit's files come back in the commit payload itself — a single request.
async function fetchCommitFiles(page: GitHubPage, token?: string): Promise<ApiResult> {
  const { owner, repo, ref } = page;
  let res: Response;
  try {
    const url = apiUrl(`/repos/${owner}/${repo}/commits/${ref}`);
    res = await fetch(url, { headers: buildHeaders(token) });
  } catch {
    return { error: "network" };
  }

  if (!res.ok) return { error: classifyError(res), rate: readRateLimit(res) };

  const data: { files?: RawFile[] } = await res.json();
  return { files: mapFiles(data.files ?? []), rate: readRateLimit(res) };
}
