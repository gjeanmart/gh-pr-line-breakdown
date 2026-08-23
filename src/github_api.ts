import type { FileEntry } from "./matcher.js";

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
  return raw.map(f => ({ filename: f.filename, added: f.additions, removed: f.deletions }));
}

export async function fetchPrFilesFromApi(token?: string): Promise<ApiResult | null> {
  const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  const [, owner, repo, pull] = match;

  const headers = buildHeaders(token);
  const files: FileEntry[] = [];
  let page = 1;

  while (page <= 30) {
    const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${pull}/files?per_page=100&page=${page}`;
    let res: Response;
    try {
      res = await fetch(url, { headers });
    } catch {
      return { error: "network" };
    }

    if (!res.ok) return { error: classifyError(res) };

    const batch: Array<{ filename: string; additions: number; deletions: number }> = await res.json();
    files.push(...mapFiles(batch));
    if (batch.length < 100) break;
    page++;
  }

  return { files };
}

export async function fetchCommitFilesFromApi(token?: string): Promise<ApiResult | null> {
  const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]+)/i);
  if (!match) return null;
  const [, owner, repo, sha] = match;

  const headers = buildHeaders(token);
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch {
    return { error: "network" };
  }

  if (!res.ok) return { error: classifyError(res) };

  const data: { files?: Array<{ filename: string; additions: number; deletions: number }> } = await res.json();
  return { files: mapFiles(data.files ?? []) };
}
