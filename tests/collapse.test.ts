// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { collapseFile, expandFile, isCollapsible } from "../src/collapse.js";

// Modelled on GitHub's DiffFileHeader: a leading chevron IconButton whose accessible name
// lives in an aria-labelledby tooltip, then the file name, then the action buttons.
function header(opts: { collapsed?: boolean; icon?: boolean; label?: "aria" | "tooltip" | "none" } = {}): HTMLElement {
  const { collapsed = false, icon = true, label = "tooltip" } = opts;
  const chevron = collapsed ? "octicon-chevron-right" : "octicon-chevron-down";
  const name = collapsed ? "Expand file" : "Collapse file";

  const el = document.createElement("div");
  el.className = "DiffFileHeader-module__diff-file-header__UuNN4";
  el.innerHTML = `
    <div class="d-flex flex-shrink-0">
      <button type="button" data-testid="copy-path" aria-label="Copy path"></button>
      <button type="button" data-testid="chevron" ${label === "aria" ? `aria-label="${name}"` : ""} ${
        label === "tooltip" ? 'aria-labelledby="tooltip-1"' : ""
      }>
        ${icon ? `<svg class="octicon ${chevron}"></svg>` : ""}
      </button>
      <span id="tooltip-1" role="tooltip">${name}</span>
    </div>
    <h3><a href="#diff-abc"><code>src/app.ts</code></a></h3>
    <button type="button" aria-label="Viewed"></button>`;
  document.body.appendChild(el);
  return el;
}

const chevronOf = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-testid="chevron"]')!;

function countClicks(el: HTMLElement): () => number {
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  return () => clicks;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("collapseFile", () => {
  it("clicks GitHub's own collapse control", () => {
    const el = header();
    const clicks = countClicks(chevronOf(el));

    expect(collapseFile(el)).toBe(true);
    expect(clicks()).toBe(1);
  });

  it("leaves an already-collapsed file alone", () => {
    const el = header({ collapsed: true });
    const clicks = countClicks(chevronOf(el));

    // false tells the caller "not ours" — so the filter will not expand it later either
    expect(collapseFile(el)).toBe(false);
    expect(clicks()).toBe(0);
  });

  it("reports failure when the header has no collapse control", () => {
    const el = document.createElement("div");
    el.innerHTML = '<button aria-label="Viewed"></button>';
    document.body.appendChild(el);

    expect(collapseFile(el)).toBe(false);
    expect(isCollapsible(el)).toBe(false);
  });

  it("falls back to the aria-label when the chevron icon is gone", () => {
    const el = header({ icon: false, label: "aria" });
    const clicks = countClicks(chevronOf(el));

    expect(collapseFile(el)).toBe(true);
    expect(clicks()).toBe(1);
  });

  it("falls back to an aria-labelledby tooltip when there is no aria-label", () => {
    const el = header({ icon: false, label: "tooltip" });
    const clicks = countClicks(chevronOf(el));

    expect(collapseFile(el)).toBe(true);
    expect(clicks()).toBe(1);
  });

  it("is not fooled by other buttons in the header", () => {
    const el = header();
    const copyClicks = countClicks(el.querySelector<HTMLElement>('[data-testid="copy-path"]')!);
    const viewedClicks = countClicks(el.querySelector<HTMLElement>('[aria-label="Viewed"]')!);

    collapseFile(el);

    expect(copyClicks()).toBe(0);
    expect(viewedClicks()).toBe(0);
  });
});

describe("expandFile", () => {
  it("clicks the control when the file is collapsed", () => {
    const el = header({ collapsed: true });
    const clicks = countClicks(chevronOf(el));

    expandFile(el);

    expect(clicks()).toBe(1);
  });

  it("does nothing when the file is already expanded", () => {
    const el = header();
    const clicks = countClicks(chevronOf(el));

    expandFile(el);

    expect(clicks()).toBe(0);
  });
});
