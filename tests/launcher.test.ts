// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

const LAUNCHER_ID = "gh-breakdown-launcher";

// The launcher module keeps no state of its own, but the widget it is paired with does, so
// each test re-imports for symmetry with widget.test.ts.
async function freshLauncher() {
  vi.resetModules();
  return import("../src/launcher.js");
}

const launcher = () => document.getElementById(LAUNCHER_ID);

/**
 * GitHub's sticky file-header toolbar, reduced to the two properties the finder actually
 * looks for: a cluster of icon-only buttons, inside something sticky. The real thing is
 * client-rendered, so there is no captured fixture to check this against — which is exactly
 * why the finder tests shape rather than class names.
 */
function stickyToolbar(): HTMLElement {
  document.body.innerHTML = `
    <main>
      <div id="sticky" style="position: sticky">
        <div id="row">
          <button aria-label="Diff settings"></button>
          <button aria-label="Conversations"></button>
          <button aria-label="Copilot"></button>
        </div>
      </div>
    </main>`;
  return document.getElementById("row")!;
}

// GitHub's global navigation: sticky, outside <main>, and stuffed with icon buttons. It is
// also the topmost sticky thing on the page, so a finder that simply took the highest
// candidate would put our icon next to the user's avatar.
const GLOBAL_NAV = `
  <header style="position: sticky">
    <div id="nav">
      <button aria-label="Search"></button>
      <button aria-label="Create new"></button>
      <button aria-label="Issues"></button>
      <button aria-label="Notifications"></button>
    </div>
  </header>`;

// A per-file diff header: sticky in its own right, with its own cluster of icon buttons.
// The first version of the finder put our icon here, at the end of the first file in the diff.
const FILE_HEADER = `
  <div class="DiffFileHeader-module__header" style="position: sticky">
    <div id="file-row">
      <button aria-label="Viewed"></button>
      <button aria-label="Comment on this file"></button>
      <button aria-label="Show options"></button>
    </div>
  </div>`;

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("placing the launcher", () => {
  it("puts itself in a sticky row of icon buttons", async () => {
    const row = stickyToolbar();
    const { ensureLauncher } = await freshLauncher();

    const button = ensureLauncher();

    expect(button.parentElement).toBe(row);
    expect(button.classList.contains("gh-breakdown-launcher--hosted")).toBe(true);
    expect(button.classList.contains("gh-breakdown-launcher--floating")).toBe(false);
  });

  it("stays out of GitHub's global navigation", async () => {
    document.body.innerHTML = `${GLOBAL_NAV}<main></main>`;
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement).toBe(document.body);
  });

  it("stays out of a per-file diff header", async () => {
    document.body.innerHTML = `<main>${FILE_HEADER}</main>`;
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement).toBe(document.body);
  });

  // Both wrong rows present, plus the right one — and the global nav is above the toolbar,
  // so "highest on the page" alone is not enough to pick correctly.
  it("picks the toolbar out of a page holding all three", async () => {
    document.body.innerHTML = `
      ${GLOBAL_NAV}
      <main>
        <div style="position: sticky"><div id="toolbar">
          <button aria-label="Diff settings"></button>
          <button aria-label="Conversations"></button>
        </div></div>
        ${FILE_HEADER}
      </main>`;
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement!.id).toBe("toolbar");
  });

  // jsdom has no layout, so the tie-break needs its rects supplied.
  it("takes the highest qualifying row when there is more than one", async () => {
    document.body.innerHTML = `
      <main>
        <div style="position: sticky"><div id="lower">
          <button aria-label="a"></button><button aria-label="b"></button>
        </div></div>
        <div style="position: sticky"><div id="upper">
          <button aria-label="c"></button><button aria-label="d"></button>
        </div></div>
      </main>`;
    // A wrapper sits at the same height as the row it wraps. jsdom reports 0 for anything
    // left unstubbed, which would make every wrapper look like the topmost thing on the page.
    const rect = (top: number) => () =>
      ({ top, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    for (const [id, top] of [["lower", 300], ["upper", 40]] as const) {
      const row = document.getElementById(id)!;
      row.getBoundingClientRect = rect(top);
      row.parentElement!.getBoundingClientRect = rect(top);
    }
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement!.id).toBe("upper");
  });

  // Primer wraps IconButtons in elements of their own, so the buttons in one visual row often
  // do not share a parent. Counting direct children found nothing to place next to on a real
  // Files-changed page, which is how the launcher ended up floating.
  it("finds a row whose buttons are each individually wrapped", async () => {
    document.body.innerHTML = `
      <main>
        <div style="position: sticky">
          <div id="toolbar">
            <span><button aria-label="Diff settings"></button></span>
            <span><button aria-label="Conversations"></button></span>
            <span><button aria-label="Copilot"></button></span>
          </div>
        </div>
      </main>`;
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement!.id).toBe("toolbar");
  });

  // The toolbar mixes plain buttons with anchors and role="button" elements.
  it("counts anchors and role=button as controls", async () => {
    document.body.innerHTML = `
      <main>
        <div style="position: sticky"><div id="toolbar">
          <a aria-label="Conversations" href="#"></a>
          <div role="button" aria-label="Copilot"></div>
        </div></div>
      </main>`;
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement!.id).toBe("toolbar");
  });

  // GitHub's real toolbar: a full-width row, with the icon cluster bunched at the right.
  //
  // Both the row and the cluster qualify, and the row is *taller*, so its top offset is the
  // smaller of the two — "highest on the page" picked the row, and appending to it left the
  // launcher at the far right edge with a few hundred pixels of empty space beside it.
  it("joins the icon cluster, not the full-width row that holds it", async () => {
    document.body.innerHTML = `
      <main>
        <div id="toolbar" style="position: sticky">
          <span id="viewed">0 / 11 viewed</span>
          <button aria-label="Submit review"></button>
          <div id="icons">
            <button aria-label="Diff settings"></button>
            <button aria-label="Conversations"></button>
            <button id="last-icon" aria-label="Copilot"></button>
          </div>
        </div>
      </main>`;
    // The row starts above the cluster it contains, exactly as a taller flex parent does.
    const rect = (top: number) => () =>
      ({ top, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    document.getElementById("toolbar")!.getBoundingClientRect = rect(10);
    document.getElementById("icons")!.getBoundingClientRect = rect(18);
    const { ensureLauncher } = await freshLauncher();

    const button = ensureLauncher();

    expect(button.parentElement!.id).toBe("icons");
    expect(button.previousElementSibling!.id).toBe("last-icon");
  });

  // Appending to the container is not the same as sitting beside the buttons: a container can
  // be far wider than the controls in it.
  it("sits immediately after the last control, not at the end of the container", async () => {
    document.body.innerHTML = `
      <main>
        <div style="position: sticky"><div id="icons">
          <span><button aria-label="Conversations"></button></span>
          <span id="last-wrapper"><button aria-label="Copilot"></button></span>
          <span id="spacer" style="flex: 1"></span>
        </div></div>
      </main>`;
    const { ensureLauncher } = await freshLauncher();

    const button = ensureLauncher();

    expect(button.previousElementSibling!.id).toBe("last-wrapper");
    expect(button.nextElementSibling!.id).toBe("spacer");
  });

  // The toolbar as it actually is: the sidebar toggle and the branch picker at the left end,
  // the action icons at the right. Both ends are innermost qualifying clusters on the same row,
  // and the left pair sits a pixel or two higher — enough for "highest wins" to choose it,
  // which put the launcher under the sidebar toggle, wrapped onto its own line.
  it("joins the right-hand icon group, not the controls at the left end", async () => {
    document.body.innerHTML = `
      <main>
        <div id="toolbar" style="position: sticky">
          <div id="left">
            <button aria-label="Collapse file tree"></button>
            <button aria-label="All commits"></button>
          </div>
          <div id="right">
            <button aria-label="Diff settings"></button>
            <button aria-label="Conversations"></button>
            <button id="last-icon" aria-label="Copilot"></button>
          </div>
        </div>
      </main>`;
    const at = (top: number, right: number) => () =>
      ({ top, right, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    document.getElementById("toolbar")!.getBoundingClientRect = at(360, 1850);
    document.getElementById("left")!.getBoundingClientRect = at(362, 200);
    document.getElementById("right")!.getBoundingClientRect = at(364, 1840);
    const { ensureLauncher } = await freshLauncher();

    const button = ensureLauncher();

    expect(button.parentElement!.id).toBe("right");
    expect(button.previousElementSibling!.id).toBe("last-icon");
  });

  // A cluster far below the toolbar is part of the diff, not the toolbar, however far right it
  // sits — so the row band is checked before the rightmost rule is applied.
  it("ignores a cluster further down the page even when it reaches further right", async () => {
    document.body.innerHTML = `
      <main>
        <div style="position: sticky"><div id="toolbar-icons">
          <button aria-label="Diff settings"></button>
          <button aria-label="Conversations"></button>
        </div></div>
        <div style="position: sticky"><div id="far-below">
          <button aria-label="Viewed"></button>
          <button aria-label="Options"></button>
        </div></div>
      </main>`;
    const at = (top: number, right: number) => () =>
      ({ top, right, bottom: 0, left: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
    for (const id of ["toolbar-icons"]) document.getElementById(id)!.getBoundingClientRect = at(360, 1200);
    for (const id of ["far-below"]) document.getElementById(id)!.getBoundingClientRect = at(900, 1840);
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement!.id).toBe("toolbar-icons");
  });

  // The fallback is the point of the design: every class-name guess in this project has
  // eventually broken, so failing to find the toolbar must not cost the reader the feature.
  it("falls back to a floating button when there is no sticky row", async () => {
    document.body.innerHTML = `<main><div><button aria-label="Copy"></button></div></main>`;
    const { ensureLauncher } = await freshLauncher();

    const button = ensureLauncher();

    expect(button.parentElement).toBe(document.body);
    expect(button.classList.contains("gh-breakdown-launcher--floating")).toBe(true);
  });

  it("ignores a cluster of buttons that is not sticky", async () => {
    document.body.innerHTML = `
      <main><div><button aria-label="a"></button><button aria-label="b"></button><button aria-label="c"></button></div></main>`;
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement).toBe(document.body);
  });

  it("ignores a sticky element holding a single button", async () => {
    document.body.innerHTML = `<main><div style="position: sticky"><button aria-label="Copy"></button></div></main>`;
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement).toBe(document.body);
  });

  it("only ever places one, however many passes run", async () => {
    stickyToolbar();
    const { ensureLauncher } = await freshLauncher();

    const first = ensureLauncher();
    const second = ensureLauncher();

    expect(second).toBe(first);
    expect(document.querySelectorAll(`#${LAUNCHER_ID}`)).toHaveLength(1);
  });

  // The sticky toolbar only exists once you have scrolled into the diff, so the content
  // script's pass may well run before it is there. The launcher has to move when it appears.
  it("moves from floating into the row once the row shows up", async () => {
    document.body.innerHTML = "";
    const { ensureLauncher } = await freshLauncher();
    const floating = ensureLauncher();
    expect(floating.classList.contains("gh-breakdown-launcher--floating")).toBe(true);

    const row = stickyToolbar();
    document.body.appendChild(floating);
    const moved = ensureLauncher();

    expect(moved).toBe(floating);
    expect(moved.parentElement).toBe(row);
    expect(moved.classList.contains("gh-breakdown-launcher--floating")).toBe(false);
  });

  // The content script runs this after every settled batch of mutations, and the search reads
  // every aria-labelled button on the page — one per file header on a large PR.
  it("does not search the page again once it is in the toolbar", async () => {
    stickyToolbar();
    const { ensureLauncher } = await freshLauncher();
    ensureLauncher();

    const spy = vi.spyOn(document, "querySelectorAll");
    ensureLauncher();

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("presents itself as a control", async () => {
    stickyToolbar();
    const { ensureLauncher } = await freshLauncher();

    const button = ensureLauncher();

    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Line breakdown");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("clears itself on navigation", async () => {
    stickyToolbar();
    const { ensureLauncher, removeLauncher } = await freshLauncher();
    ensureLauncher();

    removeLauncher();

    expect(launcher()).toBeNull();
  });
});

// Per-function tests agreed with each other and disagreed with GitHub the last three times
// something broke here, so the launcher and the popup are driven together: one popup, two
// ways in, and the launcher is the way in that survives scrolling.
describe("driving the popup", () => {
  async function mounted() {
    vi.resetModules();
    const [{ ensureLauncher }, widget, { DEFAULT_CONFIG }, { buildBreakdown }] = await Promise.all([
      import("../src/launcher.js"),
      import("../src/widget.js"),
      import("../src/config.js"),
      import("../src/matcher.js"),
    ]);
    const { categories } = DEFAULT_CONFIG;
    widget.renderHeaderIcon(buildBreakdown([{ filename: "a.ts", added: 1, removed: 0 }], categories), categories, {
      onToggleCategory: () => {},
    });
    const button = ensureLauncher();
    widget.attachAnchor(button);
    return { button, host: document.getElementById("gh-line-breakdown-host")! };
  }

  it("opens the popup on hover", async () => {
    stickyToolbar();
    const { button, host } = await mounted();

    button.dispatchEvent(new MouseEvent("mouseenter"));

    expect(host.style.display).toBe("block");
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  // With no diffstat on the page there is no anchor to hang a keydown listener off, which is
  // why Escape is bound with the popup instead.
  it("closes on Escape even with no diffstat on the page", async () => {
    stickyToolbar();
    const { button, host } = await mounted();
    button.dispatchEvent(new MouseEvent("click"));
    expect(host.style.display).toBe("block");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host.style.display).toBe("none");
  });

  it("holds the popup open on click, and releases it", async () => {
    vi.useFakeTimers();
    stickyToolbar();
    const { button, host } = await mounted();

    button.dispatchEvent(new MouseEvent("click"));
    button.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(500);
    expect(host.style.display).toBe("block");

    button.dispatchEvent(new MouseEvent("click"));
    expect(host.style.display).toBe("none");
    vi.useRealTimers();
  });
});
