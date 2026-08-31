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


// A file with hidden context lines is resolved from its "Expand all lines" button, which is
// in the diff *body* — so findHeaderContainer walks up to the whole file section, and the
// search then turns up the header chevron alongside controls belonging to the body.
//
// Giving up on that was why hiding a category collapsed some of its files and not others:
// expanded files failed, already-collapsed ones (whose bodies are not rendered, so there is
// nothing else to find) worked.
describe("more than one candidate in the handed scope", () => {
  it("takes the control GitHub names, not the one in the body", () => {
    document.body.innerHTML = `
      <div id="file">
        <div id="header">
          <button aria-label="Collapse file"><svg class="octicon octicon-chevron-down"></svg></button>
          <h3>src/popup/popup.html</h3>
        </div>
        <div id="body">
          <button aria-label="Expand all lines"><svg class="octicon octicon-chevron-down"></svg></button>
        </div>
      </div>`;
    const clicked: string[] = [];
    for (const button of Array.from(document.querySelectorAll("button"))) {
      button.addEventListener("click", () => clicked.push(button.getAttribute("aria-label")!));
    }

    expect(collapseFile(document.getElementById("file")!)).toBe(true);
    expect(clicked).toEqual(["Collapse file"]);
  });

  it("falls back to document order when nothing is named", () => {
    document.body.innerHTML = `
      <div id="file">
        <div id="header"><button id="own"><svg class="octicon octicon-chevron-down"></svg></button></div>
        <div id="body"><button id="hunk"><svg class="octicon octicon-chevron-down"></svg></button></div>
      </div>`;
    const clicked: string[] = [];
    for (const id of ["own", "hunk"]) {
      document.getElementById(id)!.addEventListener("click", () => clicked.push(id));
    }

    collapseFile(document.getElementById("file")!);

    // A file's header precedes its body, so its own control cannot be the second one found
    expect(clicked).toEqual(["own"]);
  });

  // The safety rule that motivated giving up in the first place still holds once we climb:
  // several controls up there really can mean several files.
  it("still refuses after climbing into a container of several files", () => {
    document.body.innerHTML = `
      <div id="list">
        <div><button aria-label="Collapse file"><svg class="octicon octicon-chevron-down"></svg></button></div>
        <div><button aria-label="Collapse file"><svg class="octicon octicon-chevron-down"></svg></button></div>
        <div id="name"><h3>src/app.ts</h3></div>
      </div>`;

    expect(collapseFile(document.getElementById("name")!)).toBe(false);
  });
});
