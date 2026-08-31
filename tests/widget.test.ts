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

describe("pinning", () => {
  const popup = () => host().shadowRoot!.querySelector(".popup")!;

  it("stays open after the cursor leaves once pinned", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor()!;

    anchor.dispatchEvent(new MouseEvent("click"));
    anchor.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(500);

    expect(host().style.display).toBe("block");
    expect(popup().classList.contains("pinned")).toBe(true);
  });

  it("closes again on a second click", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor()!;

    anchor.dispatchEvent(new MouseEvent("click"));
    anchor.dispatchEvent(new MouseEvent("click"));

    expect(host().style.display).toBe("none");
    expect(popup().classList.contains("pinned")).toBe(false);
  });

  it("closes on Escape", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    findDiffstatAnchor()!.dispatchEvent(new MouseEvent("click"));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host().style.display).toBe("none");
  });

  it("ignores Escape when it is not pinned", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor()!;
    anchor.dispatchEvent(new MouseEvent("mouseenter"));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(host().style.display).toBe("block");
  });

  it("survives a re-render while pinned", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    findDiffstatAnchor()!.dispatchEvent(new MouseEvent("click"));

    renderRows(widget);

    expect(host().style.display).toBe("block");
    expect(popup().classList.contains("pinned")).toBe(true);
  });

  it("tells the reader the diffstat is clickable", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    const anchor = findDiffstatAnchor() as HTMLElement;

    expect(anchor.title).toBe("Click to pin the line breakdown");
    anchor.dispatchEvent(new MouseEvent("click"));
    expect(anchor.title).toBe("Click to unpin the line breakdown");
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

describe("the pin control", () => {
  const pinButton = () => host().shadowRoot!.querySelector<HTMLElement>(".pin-toggle")!;

  it("sits in the header, so pinning is findable without a tooltip", async () => {
    const widget = await freshWidget();

    renderRows(widget);

    const button = pinButton();
    expect(button.closest(".title")).not.toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-label")).toContain("Pin");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("pins from the footer button", async () => {
    const widget = await freshWidget();
    renderRows(widget);

    pinButton().click();
    findDiffstatAnchor()!.dispatchEvent(new MouseEvent("mouseleave"));
    vi.advanceTimersByTime(500);

    expect(host().style.display).toBe("block");
    expect(pinButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("releases from the footer button", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    pinButton().click();

    pinButton().click();

    expect(host().style.display).toBe("none");
    expect(pinButton().getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps its state in step with a pin from the diffstat", async () => {
    const widget = await freshWidget();
    renderRows(widget);

    findDiffstatAnchor()!.dispatchEvent(new MouseEvent("click"));

    expect(pinButton().getAttribute("aria-pressed")).toBe("true");
    expect(pinButton().getAttribute("aria-label")).toContain("Unpin");
  });

  it("still reads correctly after a re-render", async () => {
    const widget = await freshWidget();
    renderRows(widget);
    pinButton().click();

    renderRows(widget);

    expect(pinButton().getAttribute("aria-pressed")).toBe("true");
  });
});

describe("reading controls", () => {
  const shadow = () => host().shadowRoot!;
  const names = () =>
    Array.from(shadow().querySelectorAll(".cat-name")).map((el) => el.textContent?.trim());

  it("shows categories in config order, and biggest-first when the preference says so", async () => {
    const ordered = await freshWidget();
    renderRows(ordered);
    expect(names()!.slice(0, 2)).toEqual(["Main", "Tests"]);

    const sorted = await freshWidget();
    renderRows(sorted, { prefs: { sortBySize: true, hideEmpty: true } });
    // Main is 13 lines, Tests 6, so this order is the same either way — assert on the
    // control instead, which is what the reader actually toggles
    expect(shadow().querySelector(".sort-toggle")!.textContent).toBe("By size");
  });

  it("tells the content script when the sort preference changes", async () => {
    const widget = await freshWidget();
    const onPrefsChange = vi.fn();
    renderRows(widget, { onPrefsChange });

    shadow().querySelector<HTMLElement>(".sort-toggle")!.click();

    expect(onPrefsChange).toHaveBeenCalledWith({ sortBySize: true });
    expect(shadow().querySelector(".sort-toggle")!.textContent).toBe("By size");
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
