// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { findDiffstatAnchor } from "../src/anchor.js";
import PR_HEADER from "./fixtures/pr_header.html?raw";
import COMMIT_HEADER from "./fixtures/commit_header.html?raw";

// GitHub's DiffStats component, as rendered for arbitrary counts. `squares: false` covers
// the hideSquares variant, where only the +N/-N text and the sr-only label are rendered.
function chip(added: number, removed: number, squares = true): string {
  const blocks = squares
    ? `<div class="d-flex">${'<div data-testid="addition diffstat" class="DiffSquares-module__diffSquare__r6Bwa"></div>'.repeat(5)}</div>`
    : "";
  return `
    <div class="d-flex flex-items-center gap-1">
      <span aria-hidden="true" class="f6 fgColor-success text-bold">+${added}</span>
      <span aria-hidden="true" class="f6 fgColor-danger text-bold">-${removed}</span>
      <span class="sr-only">Lines changed: ${added} additions &amp; ${removed} deletions</span>
      ${blocks}
    </div>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("findDiffstatAnchor — captured GitHub markup", () => {
  it("anchors to the diffstat chip in the PR header", () => {
    document.body.innerHTML = PR_HEADER;

    const anchor = findDiffstatAnchor();

    expect(anchor).not.toBeNull();
    expect(anchor!.textContent).toContain("+18");
    expect(anchor!.querySelector('[data-testid$="diffstat"]')).not.toBeNull();
  });

  it("skips the header slot GitHub hides at narrow widths", () => {
    document.body.innerHTML = PR_HEADER;

    // The hidden slot comes first in document order, so a naive querySelector picks it
    const naive = document.querySelector('[data-testid$="diffstat"]');
    expect(naive!.closest('[class*="rightContentWrapper"]')!.textContent).toContain("+99");

    expect(findDiffstatAnchor()!.textContent).not.toContain("+99");
  });

  it("anchors to the commit total, not a per-file diffstat", () => {
    document.body.innerHTML = COMMIT_HEADER;

    const anchor = findDiffstatAnchor();

    expect(anchor!.textContent).toContain("+2"); // header total
    expect(anchor!.closest('[class*="commitFilesChangedContainer"]')).not.toBeNull();
    expect(anchor!.closest('[class*="DiffFileHeader"]')).toBeNull();
  });

  it("returns the chip itself, not the wrapper around it", () => {
    document.body.innerHTML = PR_HEADER;

    const anchor = findDiffstatAnchor()!;

    // The chip holds the counts; its parent is GitHub's layout slot
    expect(anchor.className).not.toContain("rightContentWrapper");
    expect(anchor.parentElement!.className).toContain("rightContentWrapper");
  });
});

describe("findDiffstatAnchor — detection rules", () => {
  it("finds the chip when the squares are suppressed", () => {
    document.body.innerHTML = `<div data-component="PH_Navigation">${chip(4, 0, false)}</div>`;

    const anchor = findDiffstatAnchor();

    expect(anchor).not.toBeNull();
    expect(anchor!.textContent).toContain("+4");
  });

  it("prefers the legacy diffStatesWrap element when present", () => {
    document.body.innerHTML = `
      <div class="DiffStates-module__diffStatesWrap__abc123">${chip(7, 2)}</div>
      <div data-component="PH_Navigation">${chip(18, 1)}</div>`;

    expect(findDiffstatAnchor()!.className).toContain("diffStatesWrap");
  });

  it("ignores diffstats inside file-tree rows", () => {
    document.body.innerHTML = `
      <li role="treeitem" id="src/app.ts">${chip(3, 1)}</li>
      <div data-component="PH_Navigation">${chip(18, 1)}</div>`;

    expect(findDiffstatAnchor()!.textContent).toContain("+18");
  });

  it("ignores per-file diffstats when there is no page total", () => {
    document.body.innerHTML = `
      <div class="DiffFileHeader-module__diff-file-header__UuNN4">${chip(3, 1)}</div>`;

    expect(findDiffstatAnchor()).toBeNull();
  });

  it("returns null on a page with no diffstat at all", () => {
    document.body.innerHTML = `<div data-component="PH_Navigation"><nav>Conversation</nav></div>`;

    expect(findDiffstatAnchor()).toBeNull();
  });

  it("falls back to a sibling of the tab nav when the chip markup changes again", () => {
    // No diffstat squares and no sr-only label — only the green count survives
    document.body.innerHTML = `
      <div data-component="PH_Navigation">
        <div class="PullRequestHeader-module__rightContentWrapper__MrqTF">
          <span class="fgColor-success">+18</span>
        </div>
        <div class="flex-auto">
          <nav aria-label="Pull request navigation tabs"><a href="#">Conversation</a></nav>
        </div>
      </div>`;

    expect(findDiffstatAnchor()!.className).toContain("rightContentWrapper");
  });
});
