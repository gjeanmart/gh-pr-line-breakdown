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
    <div id="sticky" style="position: sticky">
      <div id="row">
        <button aria-label="Copy"></button>
        <button aria-label="Comment"></button>
        <button aria-label="Options"></button>
      </div>
    </div>`;
  return document.getElementById("row")!;
}

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

  // The fallback is the point of the design: every class-name guess in this project has
  // eventually broken, so failing to find the toolbar must not cost the reader the feature.
  it("falls back to a floating button when there is no sticky row", async () => {
    document.body.innerHTML = `<div><button aria-label="Copy"></button></div>`;
    const { ensureLauncher } = await freshLauncher();

    const button = ensureLauncher();

    expect(button.parentElement).toBe(document.body);
    expect(button.classList.contains("gh-breakdown-launcher--floating")).toBe(true);
  });

  it("ignores a cluster of buttons that is not sticky", async () => {
    document.body.innerHTML = `
      <div><button aria-label="a"></button><button aria-label="b"></button><button aria-label="c"></button></div>`;
    const { ensureLauncher } = await freshLauncher();

    expect(ensureLauncher().parentElement).toBe(document.body);
  });

  it("ignores a sticky element holding a single button", async () => {
    document.body.innerHTML = `<div style="position: sticky"><button aria-label="Copy"></button></div>`;
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
