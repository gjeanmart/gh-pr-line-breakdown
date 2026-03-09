import type { FileEntry } from "./matcher.js";

export type ApiError = "rate_limit" | "not_accessible" | "auth_required" | "network" | "unknown";
export type ApiResult = { files: FileEntry[] } | { error: ApiError };

export async function fetchPrFilesFromApi(token?: string): Promise<ApiResult | null> {
  const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  const [, owner, repo, pull] = match;

  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

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

    if (!res.ok) {
      if (res.status === 401) return { error: "auth_required" };
      if (res.status === 404) return { error: "not_accessible" };
      if (res.status === 429) return { error: "rate_limit" };
      if (res.status === 403) {
        const remaining = res.headers.get("X-RateLimit-Remaining");
        if (remaining === "0") return { error: "rate_limit" };
        return { error: "not_accessible" };
      }
      return { error: "unknown" };
    }

    const batch: Array<{ filename: string; additions: number; deletions: number }> = await res.json();
    for (const f of batch) {
      files.push({ filename: f.filename, added: f.additions, removed: f.deletions });
    }
    if (batch.length < 100) break;
    page++;
  }

  return { files };
}
