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

function renderRows(
  widget: Awaited<ReturnType<typeof freshWidget>>,
  truncated = false
): void {
  const { categories } = DEFAULT_CONFIG;
  widget.renderHeaderIcon(buildBreakdown(FILES, categories), categories, truncated, () => {});
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

    renderRows(widget, true);

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
