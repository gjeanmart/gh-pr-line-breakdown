import { describe, it, expect } from "vitest";
import { parseGitHubPage, parseGitHubUrl } from "../src/page.js";

const SHA = "322e2291f3ba9e4e5b6bb3d9c8a6c5f4e3d2c1b0";

describe("parseGitHubPage", () => {
  it("parses a pull request", () => {
    expect(parseGitHubPage("/gjeanmart/gh-pr-line-breakdown/pull/12")).toEqual({
      kind: "pr",
      owner: "gjeanmart",
      repo: "gh-pr-line-breakdown",
      ref: "12",
      path: "/gjeanmart/gh-pr-line-breakdown/pull/12",
    });
  });

  it("keeps the same path across a PR's tabs", () => {
    const base = parseGitHubPage("/o/r/pull/7")!.path;
    for (const tab of ["/files", "/commits", "/checks", "/files#diff-abc"]) {
      expect(parseGitHubPage(`/o/r/pull/7${tab}`)!.path).toBe(base);
    }
  });

  it("parses a commit", () => {
    expect(parseGitHubPage(`/o/r/commit/${SHA}`)).toEqual({
      kind: "commit",
      owner: "o",
      repo: "r",
      ref: SHA,
      path: `/o/r/commit/${SHA}`,
    });
  });

  it("accepts an abbreviated SHA", () => {
    expect(parseGitHubPage("/o/r/commit/322e229")?.ref).toBe("322e229");
  });

  it("accepts an uppercase SHA", () => {
    expect(parseGitHubPage("/o/r/commit/322E229")?.kind).toBe("commit");
  });

  it.each([
    ["repo root", "/o/r"],
    ["PR list", "/o/r/pulls"],
    ["global PR list", "/pulls"],
    ["commit list", "/o/r/commits/main"],
    ["non-SHA commit ref", "/o/r/commit/main"],
    ["too-short SHA", "/o/r/commit/322e2"],
    ["issue", "/o/r/issues/12"],
    ["home", "/"],
  ])("returns null for %s", (_label, path) => {
    expect(parseGitHubPage(path)).toBeNull();
  });
});

describe("parseGitHubUrl", () => {
  it("parses a full URL, ignoring query and hash", () => {
    const page = parseGitHubUrl("https://github.com/o/r/pull/12/files?w=1#diff-abc");
    expect(page).toMatchObject({ kind: "pr", ref: "12", path: "/o/r/pull/12" });
  });

  it("rejects other hosts", () => {
    expect(parseGitHubUrl("https://gist.github.com/o/r/pull/12")).toBeNull();
    expect(parseGitHubUrl("https://github.example.com/o/r/pull/12")).toBeNull();
  });

  it("rejects anything that is not a URL", () => {
    expect(parseGitHubUrl("")).toBeNull();
    expect(parseGitHubUrl("not a url")).toBeNull();
  });
});
