// @vitest-environment jsdom
//
// End-to-end over real captured markup: badge injection resolves filename -> header, and
// the category filter then has to find GitHub's collapse control from that header. Those
// two halves disagreed in v0.1.6-dev — badges landed on the inner file-path section, whose
// subtree does not contain the chevron — and the eye icon silently did nothing. Synthetic
// per-function tests all passed. Hence this one, driving both halves over the real DOM.
import { describe, it, expect, beforeEach } from "vitest";
import { injectBadges, setFilesVisible, clearBadges } from "../src/badges.js";
import { headerFor as storedHeaderFor, filesCollapsedByUs } from "../src/file_headers.js";
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

  it("puts the badge straight after the file name, expanded or collapsed", async () => {
    // The badge used to be placed relative to whichever buttons happened to be in the header,
    // and "Expand all lines" only exists while a file is expanded — so in one diff the badge
    // sat right of the path on open files and left of it on collapsed ones.
    const shape = (filename: string) =>
      Array.from(headerFor(filename).querySelectorAll("h3, button, .gh-breakdown-badge"))
        .map((el) => (el.classList.contains("gh-breakdown-badge") ? "badge" : el.tagName.toLowerCase()))
        .join(" ");

    await injectBadges(FILES, CATEGORIES);
    const whenExpanded = shape("CLAUDE.md");

    document.body.innerHTML = COMMIT_PAGE;
    Array.from(document.querySelectorAll('button[aria-label^="Expand all lines"]')).forEach((b) =>
      b.remove()
    );
    clearBadges();
    await injectBadges(FILES, CATEGORIES);

    expect(whenExpanded).toContain("h3 badge");
    expect(shape("CLAUDE.md").replace(/( button)+$/, "")).toBe(whenExpanded.replace(/( button)+$/, ""));
  });

  it("carries nothing inline but its category colours", async () => {
    // Everything else is in injected.css, which Chrome injects from the manifest — jsdom
    // does not load it, so the rules are asserted against the file below
    await injectBadges(FILES, CATEGORIES);

    const badge = document.querySelector<HTMLElement>(".gh-breakdown-badge")!;
    expect(badge.style.background).not.toBe("");
    expect(badge.style.color).not.toBe("");
    expect(badge.getAttribute("style")).not.toContain("margin");
  });

  describe("a file with every line added", () => {
    // No "Expand all lines" button, because there is nothing to expand. Those files are
    // resolved from the #diff- anchor inside the file-name heading, which is the path that
    // produced two badges per file in v0.1.7.
    beforeEach(() => {
      Array.from(document.querySelectorAll('button[aria-label^="Expand all lines"]')).forEach((b) =>
        b.remove()
      );
      clearBadges();
    });

    it("gets exactly one badge", async () => {
      expect(await injectBadges(FILES, CATEGORIES)).toBe(2);
      expect(document.querySelectorAll(".gh-breakdown-badge")).toHaveLength(2);
    });

    it("still has exactly one after repeated passes", async () => {
      // The content script re-runs after every settled batch of mutations, and on a large PR
      // GitHub keeps mutating for as long as you scroll
      for (let pass = 0; pass < 5; pass++) await injectBadges(FILES, CATEGORIES);

      expect(document.querySelectorAll(".gh-breakdown-badge")).toHaveLength(2);
    });

    it("stays at one badge each while the rest of the diff is still rendering", async () => {
      // The other half of the bug: with 18 files in the PR and 2 rendered, the "nothing to
      // do" early exit cannot fire, so every pass runs the full injection. Both halves are
      // needed — either one alone leaves the count correct, which is how the first version
      // of this test passed against the broken code.
      const wholePr = [
        ...FILES,
        ...Array.from({ length: 16 }, (_, i) => ({
          filename: `src/not-rendered-${i}.ts`,
          added: 1,
          removed: 0,
        })),
      ];

      for (let pass = 0; pass < 4; pass++) await injectBadges(wholePr, CATEGORIES);

      expect(document.querySelectorAll(".gh-breakdown-badge")).toHaveLength(2);
    });

    it("keeps the badge inside the element the duplicate check searches", async () => {
      // This is the invariant the bug broke: the badge was placed outside its own container,
      // so headerContainer.querySelector could never find it and every pass added another
      await injectBadges(FILES, CATEGORIES);

      const badge = document.querySelector(".gh-breakdown-badge")!;
      const header = badge.closest('[class*="diff-file-header"]')!;
      expect(header.querySelector(".gh-breakdown-badge")).toBe(badge);
    });
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

// "Show all" removed its own button, cleared the filter, and left every file collapsed.
//
// The expand goes through a header element stored when the badge was injected, and GitHub
// re-renders those constantly (rule 4 in file_headers.ts). Handed a stale one, expandFile
// finds no control and does nothing — but setFilesVisible used to call forgetCollapsedByUs
// regardless. So the record of what we had collapsed was thrown away while the files stayed
// shut, and nothing was left that knew to try again.
describe("expanding against a header that has gone stale", () => {
  it("keeps the record when the expand cannot land, so a later pass can retry", async () => {
    await injectBadges(FILES, CATEGORIES);
    const clicks = wireToggles(["CLAUDE.md", "README.md"]);

    setFilesVisible(["CLAUDE.md"], false);
    expect(clicks()["CLAUDE.md"]).toBe(1);

    // GitHub replaces the header. Our stored element is now detached, and clicking a control
    // inside it changes nothing the reader can see.
    const live = storedHeaderFor("CLAUDE.md")!;
    const detached = live.cloneNode(true) as HTMLElement;
    live.replaceWith(detached.cloneNode(true) as HTMLElement);

    setFilesVisible(["CLAUDE.md"], true);

    // Still on the list, so the next pass will try again against a current header
    expect(filesCollapsedByUs()).toContain("CLAUDE.md");
  });

  it("expands and forgets once the header is current again", async () => {
    await injectBadges(FILES, CATEGORIES);
    const clicks = wireToggles(["CLAUDE.md", "README.md"]);

    setFilesVisible(["CLAUDE.md"], false);
    setFilesVisible(["CLAUDE.md"], true);

    expect(clicks()["CLAUDE.md"]).toBe(2);
    expect(filesCollapsedByUs()).not.toContain("CLAUDE.md");
  });
});
