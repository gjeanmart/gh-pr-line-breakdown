// @vitest-environment jsdom
//
// End-to-end over real captured markup: badge injection resolves filename -> header, and
// the category filter then has to find GitHub's collapse control from that header. Those
// two halves disagreed in v0.1.6-dev — badges landed on the inner file-path section, whose
// subtree does not contain the chevron — and the eye icon silently did nothing. Synthetic
// per-function tests all passed. Hence this one, driving both halves over the real DOM.
import { describe, it, expect, beforeEach } from "vitest";
import { injectBadges, setFilesVisible, clearBadges } from "../src/badges.js";
import type { Category } from "../src/config.js";
import COMMIT_PAGE from "./fixtures/commit_header.html?raw";

const FILES = [
  { filename: "CLAUDE.md", added: 1, removed: 0 },
  { filename: "README.md", added: 1, removed: 0 },
];

const CATEGORIES: Category[] = [
  { name: "Documentation", color: "#1a7f37", patterns: ["**/*.md"] },
  { name: "Main", color: "#6e7781", patterns: ["**/*"], fallback: true },
];

function headerFor(filename: string): HTMLElement {
  const headers = Array.from(
    document.querySelectorAll<HTMLElement>('[class*="diff-file-header"]')
  );
  const match = headers.find((h) => h.querySelector("h3")?.textContent?.includes(filename));
  if (!match) throw new Error(`no header for ${filename}`);
  return match;
}

function chevronFor(filename: string): HTMLElement {
  const icon = headerFor(filename).querySelector(
    "svg.octicon-chevron-down, svg.octicon-chevron-right"
  );
  const button = icon?.closest("button");
  if (!button) throw new Error(`no collapse control for ${filename}`);
  return button as HTMLElement;
}

// The fixture is static markup; GitHub flips the chevron itself when its control is
// clicked, and both collapseFile and expandFile read that state. So the stand-in has to
// flip it too, otherwise a collapse/expand round trip cannot be exercised at all.
function wireToggles(filenames: string[]): () => Record<string, number> {
  const clicks: Record<string, number> = {};
  for (const filename of filenames) {
    clicks[filename] = 0;
    const button = chevronFor(filename);
    button.addEventListener("click", () => {
      clicks[filename]++;
      const icon = button.querySelector("svg")!;
      if (icon.classList.contains("octicon-chevron-down")) {
        icon.classList.replace("octicon-chevron-down", "octicon-chevron-right");
      } else {
        icon.classList.replace("octicon-chevron-right", "octicon-chevron-down");
      }
    });
  }
  return () => clicks;
}

beforeEach(() => {
  document.body.innerHTML = COMMIT_PAGE;
  clearBadges();
});

describe("category filter over captured commit markup", () => {
  it("badges every file in the diff", async () => {
    expect(await injectBadges(FILES, CATEGORIES)).toBe(2);

    const badges = Array.from(document.querySelectorAll(".gh-breakdown-badge"));
    expect(badges.map((b) => b.textContent)).toEqual(["Documentation", "Documentation"]);
    // and each badge landed inside a file header, not loose in the page
    expect(badges.every((b) => b.closest('[class*="diff-file-header"]') !== null)).toBe(true);
  });

  it("does no work on a second pass over an unchanged diff", async () => {
    expect(await injectBadges(FILES, CATEGORIES)).toBe(2);

    // The content script re-runs after every settled batch of mutations. This pass used to
    // sweep the document four times and hash every path to discover it had nothing to do.
    expect(await injectBadges(FILES, CATEGORIES)).toBe(0);
    expect(document.querySelectorAll(".gh-breakdown-badge")).toHaveLength(2);
  });

  it("re-badges after GitHub takes our badges away with a header", async () => {
    await injectBadges(FILES, CATEGORIES);
    document.body.innerHTML = COMMIT_PAGE;

    expect(await injectBadges(FILES, CATEGORIES)).toBe(2);
  });

  it("hides a category by clicking each file's collapse control", async () => {
    await injectBadges(FILES, CATEGORIES);
    const clicks = wireToggles(["CLAUDE.md", "README.md"]);

    setFilesVisible(["CLAUDE.md", "README.md"], false);

    expect(clicks()).toEqual({ "CLAUDE.md": 1, "README.md": 1 });
    expect(chevronFor("CLAUDE.md").querySelector("svg")!.classList.contains("octicon-chevron-right")).toBe(true);
  });

  it("does not click twice when an active filter is re-applied", async () => {
    await injectBadges(FILES, CATEGORIES);
    const clicks = wireToggles(["CLAUDE.md"]);

    // content_script re-applies active filters after every DOM refresh
    setFilesVisible(["CLAUDE.md"], false);
    setFilesVisible(["CLAUDE.md"], false);

    expect(clicks()["CLAUDE.md"]).toBe(1);
  });

  it("collapses and expands again on a round trip", async () => {
    await injectBadges(FILES, CATEGORIES);
    const clicks = wireToggles(["CLAUDE.md", "README.md"]);

    setFilesVisible(["CLAUDE.md", "README.md"], false);
    setFilesVisible(["CLAUDE.md", "README.md"], true);

    expect(clicks()).toEqual({ "CLAUDE.md": 2, "README.md": 2 });
    expect(chevronFor("CLAUDE.md").querySelector("svg")!.classList.contains("octicon-chevron-down")).toBe(true);
  });

  it("expands again only the files it collapsed", async () => {
    await injectBadges(FILES, CATEGORIES);
    const clicks = wireToggles(["CLAUDE.md", "README.md"]);
    setFilesVisible(["CLAUDE.md"], false);

    setFilesVisible(["CLAUDE.md", "README.md"], true);

    // README.md was never collapsed by us, so the filter leaves it alone
    expect(clicks()).toEqual({ "CLAUDE.md": 2, "README.md": 0 });
  });

  it("leaves a file the user had already collapsed alone", async () => {
    await injectBadges(FILES, CATEGORIES);
    const clicks = wireToggles(["CLAUDE.md", "README.md"]);
    // Flip CLAUDE.md's control to the collapsed state, as GitHub renders it for large diffs
    const icon = chevronFor("CLAUDE.md").querySelector("svg")!;
    icon.classList.replace("octicon-chevron-down", "octicon-chevron-right");

    setFilesVisible(["CLAUDE.md", "README.md"], false);
    setFilesVisible(["CLAUDE.md", "README.md"], true);

    // Never ours, never touched — while README.md round-trips normally
    expect(clicks()).toEqual({ "CLAUDE.md": 0, "README.md": 2 });
  });
});
