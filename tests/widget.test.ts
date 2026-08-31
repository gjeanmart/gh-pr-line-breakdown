// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildBreakdown } from "../src/matcher.js";
import { findDiffstatAnchor } from "../src/anchor.js";
import PR_HEADER from "./fixtures/pr_header.html?raw";

const HOST_ID = "gh-line-breakdown-host";

const FILES = [
  { filename: "src/app.ts", added: 12, removed: 1 },
  { filename: "src/app.test.ts", added: 6, removed: 0 },
];

// The widget module keeps the shadow host and the bound anchor in module state, so each
// test gets a fresh copy.
async function freshWidget() {
  vi.resetModules();
  return import("../src/widget.js");
}

const host = () => document.getElementById(HOST_ID)!;
const shadowStyle = () => host().shadowRoot!.querySelector("style")!.textContent!;
const shadow = () => host().shadowRoot!;

/**
 * The class selectors the widget's stylesheet actually declares rules for.
 *
 * Comments are stripped first, and selectors are read from the text before each block. Asking
 * whether the raw stylesheet *contains* a class name is not the same question: the block that
 * styles the footer carries a comment naming the very classes it styles, so a broken
 * stylesheet passed that check on its own prose.
 */
function styledSelectors(): string[] {
  const css = shadowStyle().replace(/\/\*[\s\S]*?\*\//g, "");
  return css
    .split("}")
    .flatMap((block) => block.split("{")[0].split(","))
    .map((selector) => selector.trim())
    .filter(Boolean)
    .flatMap((selector) => selector.match(/\.[a-zA-Z0-9_-]+/g) ?? []);
}

// jsdom has no layout engine, so every rect is zero. The positioning maths is the point here,
// so the rect is supplied.
function stubRect(el: HTMLElement, rect: { bottom: number; right: number }): void {
  el.getBoundingClientRect = () => ({ ...rect, top: 0, left: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
}

type Widget = Awaited<ReturnType<typeof freshWidget>>;

function renderRows(widget: Widget, ctx: Parameters<Widget["renderHeaderIcon"]>[2] = {}): void {
  const { categories } = DEFAULT_CONFIG;
  widget.renderHeaderIcon(buildBreakdown(FILES, categories), categories, {
    onToggleCategory: () => {},
    ...ctx,
  });
}

beforeEach(() => {
  document.body.innerHTML = PR_HEADER;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.getElementById(HOST_ID)?.remove();
});

describe("widget visibility", () => {
  it("stays closed when the loading state renders", async () => {
    const widget = await freshWidget();

    widget.renderLoadingState();

    expect(host()).not.toBeNull();
    expect(host().style.display).toBe("none");
  });

  it("stays closed when the breakdown renders", async () => {
    const widget = await freshWidget();

    renderRows(widget);

    expect(host().style.display).toBe("none");
  });

  it("stays closed when an error renders", async () => {
    const widget = await freshWidget();

    widget.renderError("rate_limit");

    expect(host().style.display).toBe("none");
    expect(host().shadowRoot!.textContent).toContain("Rate limit");
  });

  it("opens on hovering the diffstat and closes on leaving it", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor()!;

    anchor.dispatchEvent(new MouseEvent("mouseenter"));
    expect(host().style.display).toBe("block");

    anchor.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(200);
    expect(host().style.display).toBe("none");
  });

  it("keeps the popup open while its content is replaced", async () => {
    const widget = await freshWidget();
    widget.renderLoadingState();
    const anchor = findDiffstatAnchor()!;
    anchor.dispatchEvent(new MouseEvent("mouseenter"));

    renderRows(widget);

    expect(host().style.display).toBe("block");
    expect(host().shadowRoot!.textContent).toContain("Tests");
  });

  it("does not close while the cursor moves from the diffstat onto the popup", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor()!;

    anchor.dispatchEvent(new MouseEvent("mouseenter"));
    anchor.dispatchEvent(new MouseEvent("mouseleave"));
    host().dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(200);

    expect(host().style.display).toBe("block");
  });
});

describe("error marker on the diffstat", () => {
  const marker = () => findDiffstatAnchor()!.querySelectorAll(".gh-breakdown-alert");

  it("marks the chip when the breakdown could not be loaded", async () => {
    const widget = await freshWidget();

    widget.renderError("rate_limit");

    // The popup only opens on hover, so the chip itself has to carry the signal
    expect(marker().length).toBe(1);
  });

  it("clears the marker once the breakdown arrives", async () => {
    const widget = await freshWidget();
    widget.renderError("network");

    renderRows(widget);

    expect(marker().length).toBe(0);
  });

  it("clears the marker while reloading", async () => {
    const widget = await freshWidget();
    widget.renderError("network");

    widget.renderLoadingState();

    expect(marker().length).toBe(0);
  });

  it("never stacks markers", async () => {
    const widget = await freshWidget();

    widget.renderError("unknown");
    widget.renderError("unknown");
    widget.renderError("unknown");

    expect(marker().length).toBe(1);
  });

  it("re-marks a chip that GitHub has re-rendered", async () => {
    const widget = await freshWidget();
    widget.renderError("auth_required");

    // React re-render: same markup, all new elements — including our host's parent
    document.body.innerHTML = PR_HEADER;
    widget.renderError("auth_required");

    expect(marker().length).toBe(1);
    expect(host().shadowRoot!.textContent).toContain("Authentication required");
  });
});

describe("truncated file lists", () => {
  const header = () => host().shadowRoot!.querySelector(".total-files")!;

  it("says the file count is partial when the API capped it", async () => {
    const widget = await freshWidget();

    renderRows(widget, { truncated: true });

    expect(header().textContent).toBe("first 2 files");
    expect(header().getAttribute("title")).toContain("3,000 max");
  });

  it("says nothing extra for a normal PR", async () => {
    const widget = await freshWidget();

    renderRows(widget);

    expect(header().textContent).toBe("2 files");
    expect(header().getAttribute("title")).toBeNull();
  });
});

describe("quota and token guidance", () => {
  const shadow = () => host().shadowRoot!;
  const rate = (remaining: number, resetAt: number | null = null) => ({ remaining, limit: 60, resetAt });

  it("says how many calls are left once the number starts to matter", async () => {
    const widget = await freshWidget();

    renderRows(widget, { rate: rate(7), hasToken: false, onOpenSettings: () => {} });

    expect(shadow().querySelector(".quota")!.textContent).toContain("7 API calls left this hour");
  });

  it("keeps quiet while there is plenty of quota", async () => {
    const widget = await freshWidget();

    renderRows(widget, { rate: rate(48), hasToken: false, onOpenSettings: () => {} });

    expect(shadow().querySelector(".quota")).toBeNull();
  });

  it("warns a token holder too — 15 of 5,000 is worse news than 15 of 60", async () => {
    const widget = await freshWidget();

    renderRows(widget, { rate: rate(2), hasToken: true, onOpenSettings: () => {} });

    const quota = shadow().querySelector(".quota")!;
    expect(quota.textContent).toContain("2 API calls left");
    // ...but suggesting a token to someone who has one would be nonsense
    expect(quota.textContent).not.toContain("add a token");
  });

  it("suggests a token when there is none", async () => {
    const widget = await freshWidget();

    renderRows(widget, { rate: rate(2), hasToken: false, onOpenSettings: () => {} });

    expect(shadow().querySelector(".quota")!.textContent).toContain("add a token");
  });

  it("reads correctly for a single remaining call", async () => {
    const widget = await freshWidget();

    renderRows(widget, { rate: rate(1), onOpenSettings: () => {} });

    expect(shadow().querySelector(".quota")!.textContent).toContain("1 API call left");
  });

  it("offers a way to the token field when the error is one a token fixes", async () => {
    const widget = await freshWidget();
    const opened = vi.fn();

    widget.renderError("rate_limit", { onOpenSettings: opened, rate: rate(0) });
    shadow().querySelector<HTMLElement>(".settings-action")!.click();

    expect(opened).toHaveBeenCalledOnce();
  });

  it("says when the quota resets", async () => {
    const widget = await freshWidget();
    // 1 Jan 2026, 09:05 local
    const resetAt = new Date(2026, 0, 1, 9, 5).getTime();

    widget.renderError("rate_limit", { rate: rate(0, resetAt), onOpenSettings: () => {} });

    expect(shadow().querySelector(".error")!.textContent).toMatch(/Resets at 0?9:05/);
  });

  it("offers nothing to click for an error a token cannot fix", async () => {
    const widget = await freshWidget();

    widget.renderError("network", { onOpenSettings: () => {} });

    expect(shadow().querySelector(".settings-action")).toBeNull();
  });

  it("labels the action differently when a token is already set", async () => {
    const widget = await freshWidget();

    widget.renderError("not_accessible", { hasToken: true, onOpenSettings: () => {} });

    expect(shadow().querySelector(".settings-action")!.textContent).toBe("Check your token");
  });
});

describe("holding the popup open", () => {
  it("stays open after the cursor leaves once clicked", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor()!;

    anchor.dispatchEvent(new MouseEvent("click"));
    anchor.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(500);

    expect(host().style.display).toBe("block");
  });

  it("closes again on a second click", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor()!;

    anchor.dispatchEvent(new MouseEvent("click"));
    anchor.dispatchEvent(new MouseEvent("click"));

    expect(host().style.display).toBe("none");
  });

  it("closes on Escape", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    findDiffstatAnchor()!.dispatchEvent(new MouseEvent("click"));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host().style.display).toBe("none");
  });

  it("ignores Escape when it is only hovered", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    findDiffstatAnchor()!.dispatchEvent(new MouseEvent("mouseenter"));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host().style.display).toBe("block");
  });

  it("survives a re-render while open", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    findDiffstatAnchor()!.dispatchEvent(new MouseEvent("click"));

    renderRows(widget);

    expect(host().style.display).toBe("block");
  });

  it("makes GitHub's diffstat into a real control", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;

    expect(anchor.title).toBe("Line breakdown");
    expect(anchor.getAttribute("role")).toBe("button");
    expect(anchor.tabIndex).toBe(0);
    expect(anchor.getAttribute("aria-expanded")).toBe("false");

    anchor.dispatchEvent(new MouseEvent("click"));
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens on focus and closes on blur", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;

    anchor.dispatchEvent(new FocusEvent("focus"));
    expect(host().style.display).toBe("block");

    anchor.dispatchEvent(new FocusEvent("blur"));
    expect(host().style.display).toBe("none");
  });

  // Tab order runs from the diffstat into the popup's own buttons, and losing the popup on the
  // way there would make every control in it unreachable by keyboard.
  it("does not close when focus moves into the popup", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;
    anchor.dispatchEvent(new FocusEvent("focus"));

    anchor.dispatchEvent(new FocusEvent("blur", { relatedTarget: host() }));

    expect(host().style.display).toBe("block");
  });
});

// Browsers focus an element on mousedown, so a real click arrives as focus-then-click and a
// real Enter arrives on an already-focused element. Dispatching activation on its own — which
// every test here used to do — hid a bug that made every activation a no-op: focus set the
// held-open flag, and the activation handler then toggled it straight back off.
describe("activation in the order a browser fires it", () => {
  it("holds the popup open on click after focus", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;

    anchor.dispatchEvent(new MouseEvent("mouseenter"));
    anchor.dispatchEvent(new FocusEvent("focus"));
    anchor.dispatchEvent(new MouseEvent("click"));
    anchor.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(500);

    expect(host().style.display).toBe("block");
  });

  it("holds the popup open on Enter after tabbing in", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;

    anchor.dispatchEvent(new FocusEvent("focus"));
    anchor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    anchor.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(500);

    expect(host().style.display).toBe("block");
  });

  it("still closes on a second click", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;

    anchor.dispatchEvent(new FocusEvent("focus"));
    anchor.dispatchEvent(new MouseEvent("click"));
    anchor.dispatchEvent(new MouseEvent("click"));

    expect(host().style.display).toBe("none");
  });

  // Focus shows the popup, which is what makes it reachable by keyboard at all; it must not
  // hold it, or the click that follows a mousedown has nothing left to do.
  it("shows on focus without holding, so hover still closes it", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;

    anchor.dispatchEvent(new FocusEvent("focus"));
    expect(host().style.display).toBe("block");

    anchor.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(500);
    expect(host().style.display).toBe("none");
  });
});

describe("escaping category names", () => {
  // A name reaches four DOM sites and an imported config can carry anything config.ts admits,
  // quotes included. data-cat beside these two was escaped; the title and the label were not.
  it("escapes the eye's title and label", async () => {
    const widget = await freshWidget();
    const categories = [
      { name: 'Docs "API"', patterns: ["*.md"] },
      { name: "Main", patterns: [], fallback: true },
    ];
    widget.renderHeaderIcon(
      buildBreakdown([{ filename: "README.md", added: 1, removed: 0 }], categories),
      categories,
      { onToggleCategory: () => {} }
    );

    const eye = shadow().querySelector<HTMLElement>('.cat-toggle[data-cat^="Docs"]')!;
    expect(eye.getAttribute("title")).toContain('Docs "API"');
    expect(eye.getAttribute("aria-label")).toContain('Docs "API"');
    // The attribute parsed as one value rather than closing early and spilling the rest
    expect(eye.getAttributeNames().sort()).toEqual(
      ["aria-label", "class", "data-cat", "title"].sort()
    );
  });
});

describe("staying with its anchor", () => {
  // The whole reason the pin was dropped: the popup used to be placed in document
  // coordinates, so it scrolled off the top of the screen and left the reader with an open
  // popup they could not see.
  it("positions itself in viewport coordinates", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;
    stubRect(anchor, { bottom: 100, right: 400 });

    anchor.dispatchEvent(new MouseEvent("click"));

    expect(host().style.position).toBe("");
    expect(shadowStyle()).toContain("position: fixed");
    expect(host().style.top).toBe("108px");
  });

  it("follows its anchor as the page scrolls", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;
    stubRect(anchor, { bottom: 100, right: 400 });
    anchor.dispatchEvent(new MouseEvent("click"));

    stubRect(anchor, { bottom: 20, right: 400 });
    window.dispatchEvent(new Event("scroll"));

    expect(host().style.top).toBe("28px");
  });

  it("never places itself off the left edge", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;
    stubRect(anchor, { bottom: 10, right: 20 });

    anchor.dispatchEvent(new MouseEvent("click"));
    vi.advanceTimersByTime(50);

    // offsetWidth is 0 under jsdom, so 20 - 0 = 20; the clamp is what is under test
    expect(parseInt(host().style.left, 10)).toBeGreaterThanOrEqual(8);
  });
});

describe("the footer controls", () => {
  // The bug this pins: .sort-toggle and .show-all were rendered but never appeared in the
  // stylesheet, so they fell back to the browser's default grey button. Easy to miss reading
  // either file alone, and invisible to a test that only asks whether the button exists.
  it("styles every control it renders", async () => {
    const widget = await freshWidget();
    widget.setHiddenCategories(["Tests"]);
    renderRows(widget, { prefs: { sortBySize: false, hideEmpty: true } });

    const classes = Array.from(host().shadowRoot!.querySelectorAll(".footer button"))
      .flatMap((button) => Array.from(button.classList));

    expect(classes).toEqual(["sort-toggle", "copy-md", "toggle-empty", "show-all"]);
    for (const name of classes) expect(styledSelectors()).toContain(`.${name}`);
  });

  it("offers Show all once something is hidden, and not before", async () => {
    const widget = await freshWidget();

    renderRows(widget);
    expect(shadow().querySelector(".show-all")).toBeNull();

    widget.setHiddenCategories(["Tests"]);
    renderRows(widget);
    expect(shadow().querySelector(".show-all")).not.toBeNull();
  });

  // The label names the action, like "Hide empty" and "Copy markdown" beside it. Labelled
  // with the state instead, a working toggle read as a stuck one.
  it("labels the sort control with what clicking will do", async () => {
    const widget = await freshWidget();

    renderRows(widget, { prefs: { sortBySize: false, hideEmpty: true } });
    expect(shadow().querySelector(".sort-toggle")!.textContent).toBe("Sort by size");

    renderRows(widget, { prefs: { sortBySize: true, hideEmpty: true } });
    expect(shadow().querySelector(".sort-toggle")!.textContent).toBe("Sort in order");
  });
});

describe("sorting", () => {
  // Config order and size order coincide on plenty of real PRs — the biggest category is
  // often the first one listed — so this uses a breakdown where they cannot.
  const MIXED = [
    { filename: "a.test.ts", added: 500, removed: 0 },
    { filename: "README.md", added: 5, removed: 0 },
    { filename: "src/app.ts", added: 50, removed: 0 },
  ];

  const visibleNames = () =>
    Array.from(host().shadowRoot!.querySelectorAll(".row:not(.row--empty) .cat-name"))
      .map((el) => el.textContent!.trim());

  function render(widget: Widget, sortBySize: boolean): void {
    const { categories } = DEFAULT_CONFIG;
    widget.renderHeaderIcon(buildBreakdown(MIXED, categories), categories, {
      prefs: { sortBySize, hideEmpty: true },
    });
  }

  it("follows category order by default, which is matching precedence", async () => {
    const widget = await freshWidget();

    render(widget, false);

    expect(visibleNames()).toEqual(["Main", "Tests", "Documentation"]);
  });

  it("puts the biggest category first when asked", async () => {
    const widget = await freshWidget();

    render(widget, true);

    expect(visibleNames()).toEqual(["Tests", "Main", "Documentation"]);
  });

  it("reorders on click, without the content script", async () => {
    const widget = await freshWidget();
    render(widget, false);

    shadow().querySelector<HTMLElement>(".sort-toggle")!.click();

    expect(visibleNames()).toEqual(["Tests", "Main", "Documentation"]);
  });
});

describe("copy as markdown", () => {
  const clickCopy = () => host().shadowRoot!.querySelector<HTMLElement>(".copy-md")!.click();

  it("writes a markdown table to the clipboard", async () => {
    const widget = await freshWidget();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderRows(widget);

    clickCopy();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());

    const markdown = writeText.mock.calls[0][0] as string;
    expect(markdown).toContain("| Category | Files | Added | Removed | Share |");
    expect(markdown).toContain("| Tests |");
    expect(markdown).toContain("**Total**");
    vi.unstubAllGlobals();
  });

  it("notes a capped file list in the copied table", async () => {
    const widget = await freshWidget();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderRows(widget, { truncated: true });

    clickCopy();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce());

    expect(writeText.mock.calls[0][0]).toContain("first 3,000 files");
    vi.unstubAllGlobals();
  });

  it("says so when the clipboard refuses", async () => {
    const widget = await freshWidget();
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
    renderRows(widget);
    const button = host().shadowRoot!.querySelector<HTMLElement>(".copy-md")!;

    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe("Copy failed"));

    vi.unstubAllGlobals();
  });
});

describe("reading controls", () => {
  const shadow = () => host().shadowRoot!;
  const names = () =>
    Array.from(shadow().querySelectorAll(".cat-name")).map((el) => el.textContent?.trim());

  // The ordering itself is covered in "sorting", against a breakdown where config order and
  // size order actually differ. This file's own FILES has Main at 13 lines and Tests at 6, so
  // both orders agree and it can only check the default.
  it("shows categories in config order by default", async () => {
    const ordered = await freshWidget();
    renderRows(ordered);
    expect(names()!.slice(0, 2)).toEqual(["Main", "Tests"]);
  });

  it("tells the content script when the sort preference changes", async () => {
    const widget = await freshWidget();
    const onPrefsChange = vi.fn();
    renderRows(widget, { onPrefsChange });

    shadow().querySelector<HTMLElement>(".sort-toggle")!.click();

    expect(onPrefsChange).toHaveBeenCalledWith({ sortBySize: true });
    expect(shadow().querySelector(".sort-toggle")!.textContent).toBe("Sort in order");
  });

  it("persists the empty-category toggle too", async () => {
    const widget = await freshWidget();
    const onPrefsChange = vi.fn();
    renderRows(widget, { onPrefsChange });

    shadow().querySelector<HTMLElement>(".toggle-empty")!.click();

    expect(onPrefsChange).toHaveBeenCalledWith({ hideEmpty: false });
  });
});

describe("the category filter", () => {
  const shadow = () => host().shadowRoot!;
  const eye = (name: string) =>
    shadow().querySelector<HTMLElement>(`.cat-toggle[data-cat="${name}"]`)!;

  it("hides one category and says so", async () => {
    const widget = await freshWidget();
    const onToggleCategory = vi.fn();
    const onFilterChange = vi.fn();
    renderRows(widget, { onToggleCategory, onFilterChange });

    eye("Tests").click();

    expect(onToggleCategory).toHaveBeenCalledWith("Tests", false);
    expect(onFilterChange).toHaveBeenCalledWith(["Tests"]);
  });

  it("alt-click hides everything else instead", async () => {
    const widget = await freshWidget();
    const onToggleCategory = vi.fn();
    renderRows(widget, { onToggleCategory });

    eye("Tests").dispatchEvent(new MouseEvent("click", { altKey: true, bubbles: true }));

    // Eight categories hidden in one click, and Tests is not one of them
    const hidden = onToggleCategory.mock.calls.filter(([, visible]) => visible === false);
    expect(hidden.map(([name]) => name)).not.toContain("Tests");
    expect(hidden.length).toBe(DEFAULT_CONFIG.categories.length - 1);
  });

  it("offers Show all only once something is hidden", async () => {
    const widget = await freshWidget();
    renderRows(widget, { onToggleCategory: () => {} });
    expect(shadow().querySelector(".show-all")).toBeNull();

    eye("Tests").click();

    expect(shadow().querySelector(".show-all")).not.toBeNull();
  });

  it("Show all brings everything back in one click", async () => {
    const widget = await freshWidget();
    const onFilterChange = vi.fn();
    renderRows(widget, { onToggleCategory: () => {}, onFilterChange });
    eye("Tests").dispatchEvent(new MouseEvent("click", { altKey: true, bubbles: true }));

    shadow().querySelector<HTMLElement>(".show-all")!.click();

    expect(onFilterChange).toHaveBeenLastCalledWith([]);
    expect(shadow().querySelector(".show-all")).toBeNull();
  });

  it("restores a filter remembered from a previous visit", async () => {
    const widget = await freshWidget();

    widget.setHiddenCategories(["Tests"]);
    renderRows(widget, { onToggleCategory: () => {} });

    expect(eye("Tests").classList.contains("cat-toggle--hidden")).toBe(true);
    expect(shadow().querySelector(".show-all")).not.toBeNull();
  });
});

describe("keyboard access", () => {
  it("makes GitHub's diffstat a real button", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;

    expect(anchor.tabIndex).toBe(0);
    expect(anchor.getAttribute("role")).toBe("button");
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens on Enter and on Space", async () => {
    for (const key of ["Enter", " "]) {
      const widget = await freshWidget();
      renderRows(widget);
      const anchor = findDiffstatAnchor() as HTMLElement;

      anchor.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

      expect(host().style.display, `key ${JSON.stringify(key)}`).toBe("block");
      expect(anchor.getAttribute("aria-expanded")).toBe("true");
      host().remove();
    }
  });

  it("ignores other keys", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;

    anchor.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(host().style.display).toBe("none");
  });
});
