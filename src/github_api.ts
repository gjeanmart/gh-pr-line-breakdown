import type { FileEntry } from "./matcher.js";

export async function fetchPrFilesFromApi(token?: string): Promise<FileEntry[] | null> {
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
      return null;
    }
    if (!res.ok) return null;

    const batch: Array<{ filename: string; additions: number; deletions: number }> = await res.json();
    for (const f of batch) {
      files.push({ filename: f.filename, added: f.additions, removed: f.deletions });
    }
    if (batch.length < 100) break;
    page++;
  }

  return files;
}
