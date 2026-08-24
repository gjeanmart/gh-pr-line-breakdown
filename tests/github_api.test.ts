import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchFiles, apiUrl, MAX_FILES } from "../src/github_api.js";
import type { GitHubPage } from "../src/page.js";

const PR: GitHubPage = { kind: "pr", owner: "o", repo: "r", ref: "12", path: "/o/r/pull/12" };
const COMMIT: GitHubPage = { kind: "commit", owner: "o", repo: "r", ref: "abc1234", path: "/o/r/commit/abc1234" };

type Handler = (url: string, init?: RequestInit) => Response;

function stubFetch(handler: Handler) {
  const spy = vi.fn((url: unknown, init?: RequestInit) => Promise.resolve(handler(String(url), init)));
  vi.stubGlobal("fetch", spy);
  return spy;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const fail = (status: number, headers?: Record<string, string>) =>
  new Response("{}", { status, headers });

const rawFiles = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({
    filename: `src/file${offset + i}.ts`,
    additions: 2,
    deletions: 1,
  }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchFiles — pull requests", () => {
  it("maps the API's field names to ours", async () => {
    stubFetch(() => ok([{ filename: "src/app.ts", additions: 12, deletions: 3 }]));

    const result = await fetchFiles(PR);

    expect(result).toMatchObject({ files: [{ filename: "src/app.ts", added: 12, removed: 3 }] });
  });

  it("reads the quota from a successful response", async () => {
    stubFetch(
      () =>
        new Response("[]", {
          status: 200,
          headers: { "X-RateLimit-Remaining": "42", "X-RateLimit-Limit": "60" },
        })
    );

    expect(await fetchFiles(PR)).toEqual({
      files: [],
      rate: { remaining: 42, limit: 60, resetAt: null },
    });
  });

  it("reports no quota when the headers are absent", async () => {
    stubFetch(() => ok([]));

    expect(await fetchFiles(PR)).toEqual({ files: [], rate: undefined });
  });

  it("follows pagination until a short page arrives", async () => {
    // Matching on the URL would be a trap: "per_page=100" contains "page=1"
    let call = 0;
    const spy = stubFetch(() => ok(++call === 1 ? rawFiles(100) : rawFiles(40, 100)));

    const result = await fetchFiles(PR);

    expect(spy).toHaveBeenCalledTimes(2);
    expect("files" in result && result.files).toHaveLength(140);
    expect(result).not.toHaveProperty("truncated");
  });

  it("reports truncation when every page comes back full", async () => {
    const spy = stubFetch(() => ok(rawFiles(100)));

    const result = await fetchFiles(PR);

    expect(spy).toHaveBeenCalledTimes(30);
    expect("files" in result && result.files).toHaveLength(MAX_FILES);
    expect(result).toHaveProperty("truncated", true);
  });

  it("sends the token when there is one, and no auth header when there is not", async () => {
    const spy = stubFetch(() => ok([]));

    await fetchFiles(PR, "ghp_secret");
    await fetchFiles(PR);

    const [withToken, without] = spy.mock.calls.map(([, init]) => init?.headers as Record<string, string>);
    expect(withToken.Authorization).toBe("Bearer ghp_secret");
    expect(without.Authorization).toBeUndefined();
  });
});

describe("fetchFiles — commits", () => {
  it("takes the files out of the commit payload in one request", async () => {
    const spy = stubFetch(() => ok({ files: rawFiles(3) }));

    const result = await fetchFiles(COMMIT);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain("/commits/abc1234");
    expect("files" in result && result.files).toHaveLength(3);
  });

  it("copes with a commit payload that has no files at all", async () => {
    stubFetch(() => ok({ sha: "abc1234" }));

    expect(await fetchFiles(COMMIT)).toMatchObject({ files: [] });
  });
});

describe("fetchFiles — failures", () => {
  it.each([
    ["401", 401, undefined, "auth_required"],
    ["404", 404, undefined, "not_accessible"],
    ["429", 429, undefined, "rate_limit"],
    ["403 with quota left", 403, { "X-RateLimit-Remaining": "17" }, "not_accessible"],
    ["403 out of quota", 403, { "X-RateLimit-Remaining": "0" }, "rate_limit"],
    ["500", 500, undefined, "unknown"],
  ])("maps %s to %s", async (_label, status, headers, expected) => {
    stubFetch(() => fail(status as number, headers as Record<string, string> | undefined));

    // toMatchObject: an error response may also carry the rate-limit headers
    expect(await fetchFiles(PR)).toMatchObject({ error: expected });
  });

  it("keeps the quota headers from a failed response", async () => {
    // This is how the widget knows when a rate limit resets
    stubFetch(() =>
      fail(403, { "X-RateLimit-Remaining": "0", "X-RateLimit-Limit": "60", "X-RateLimit-Reset": "1800000000" })
    );

    expect(await fetchFiles(PR)).toEqual({
      error: "rate_limit",
      rate: { remaining: 0, limit: 60, resetAt: 1800000000000 },
    });
  });

  it("maps a thrown request to a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));

    expect(await fetchFiles(PR)).toEqual({ error: "network" });
    expect(await fetchFiles(COMMIT)).toEqual({ error: "network" });
  });
});

describe("credential safety", () => {
  it("only ever calls api.github.com", async () => {
    const spy = stubFetch(() => ok([]));

    await fetchFiles(PR, "ghp_secret");
    await fetchFiles(COMMIT, "ghp_secret");

    for (const [url] of spy.mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://api.github.com");
    }
  });

  it("refuses to build a URL that leaves that origin", () => {
    // Today's call sites cannot reach these — every path is a literal starting "/repos/" —
    // which is the point: the guard is there for the change that comes later
    expect(() => apiUrl("//evil.example/repos/o/r")).toThrow(/refusing to send credentials/);
    expect(() => apiUrl("https://evil.example/repos/o/r")).toThrow(/refusing to send credentials/);
    expect(() => apiUrl("http://api.github.com/repos/o/r")).toThrow(/refusing to send credentials/);
  });

  it("allows ordinary paths, traversal and all", () => {
    expect(apiUrl("/repos/o/r/pulls/12/files?per_page=100")).toBe(
      "https://api.github.com/repos/o/r/pulls/12/files?per_page=100"
    );
    // ".." normalises back onto the same origin, so it is not a leak and is not refused
    expect(apiUrl("/repos/../x")).toBe("https://api.github.com/x");
  });
});
