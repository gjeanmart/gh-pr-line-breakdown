import { describe, it, expect } from "vitest";
import { safeCssColor, readableTextColor, DEFAULT_CATEGORY_COLOR } from "../src/color.js";
import { DEFAULT_CONFIG } from "../src/config.js";

describe("safeCssColor", () => {
  it("passes hex values through", () => {
    expect(safeCssColor("#0969da")).toBe("#0969da");
    expect(safeCssColor("#FFF")).toBe("#FFF");
    expect(safeCssColor("#1f2328ff")).toBe("#1f2328ff");
    expect(safeCssColor("  #cf222e  ")).toBe("#cf222e");
  });

  it("falls back for anything that is not a hex value", () => {
    // The colour input only ever produces #rrggbb, so nothing legitimate is refused
    expect(safeCssColor(undefined)).toBe(DEFAULT_CATEGORY_COLOR);
    expect(safeCssColor("")).toBe(DEFAULT_CATEGORY_COLOR);
    expect(safeCssColor("red")).toBe(DEFAULT_CATEGORY_COLOR);
    expect(safeCssColor("rgb(1,2,3)")).toBe(DEFAULT_CATEGORY_COLOR);
    expect(safeCssColor("#12345")).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it("refuses values that would break out of an attribute or a style", () => {
    // What an imported config file could otherwise smuggle into the options page markup
    // and into a badge's inline style
    expect(safeCssColor('#fff" onfocus="alert(1)')).toBe(DEFAULT_CATEGORY_COLOR);
    expect(safeCssColor("red;position:fixed;inset:0;z-index:99999")).toBe(DEFAULT_CATEGORY_COLOR);
    expect(safeCssColor("url(https://example.com/x.png)")).toBe(DEFAULT_CATEGORY_COLOR);
    expect(safeCssColor("#fff<script>")).toBe(DEFAULT_CATEGORY_COLOR);
  });

  it("honours a caller's own fallback", () => {
    expect(safeCssColor("nonsense", "#0969da")).toBe("#0969da");
  });
});

describe("readableTextColor", () => {
  it("puts white on dark backgrounds", () => {
    expect(readableTextColor("#0969da")).toBe("#ffffff"); // Tests blue
    expect(readableTextColor("#cf222e")).toBe("#ffffff"); // Infrastructure red
    expect(readableTextColor("#6639ba")).toBe("#ffffff"); // Config purple
    expect(readableTextColor("#000000")).toBe("#ffffff");
  });

  it("puts dark text on pale backgrounds", () => {
    // The colour picker happily offers these, and they used to render white on near-white
    expect(readableTextColor("#ffffff")).toBe("#1f2328");
    expect(readableTextColor("#f5f5f5")).toBe("#1f2328");
    expect(readableTextColor("#ffe066")).toBe("#1f2328");
    expect(readableTextColor("#7fffd4")).toBe("#1f2328");
  });

  it("expands shorthand hex", () => {
    expect(readableTextColor("#fff")).toBe(readableTextColor("#ffffff"));
    expect(readableTextColor("#000")).toBe(readableTextColor("#000000"));
  });

  it("routes unusable input through the default colour", () => {
    // Not white: it lands on the default grey, which itself reads better with dark text
    expect(readableTextColor("not a colour")).toBe(readableTextColor(DEFAULT_CATEGORY_COLOR));
  });

  it("picks these text colours for the default categories", () => {
    // Pinned deliberately: two of the nine defaults flip from white to dark text, which is
    // the visible consequence of choosing by contrast instead of always using white.
    const chosen = Object.fromEntries(
      DEFAULT_CONFIG.categories.map((c) => [c.name, readableTextColor(safeCssColor(c.color))])
    );

    expect(chosen).toEqual({
      "Main": "#ffffff",
      "Tests": "#ffffff",
      "Documentation": "#ffffff",
      "Generated / Other": "#1f2328",
      "CI/CD": "#1f2328",
      "Infrastructure": "#ffffff",
      "Config": "#ffffff",
      "Database": "#ffffff",
      "Styles": "#ffffff",
    });
  });
});
