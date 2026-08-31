// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  rememberHeader,
  headerFor,
  knownHeaderCount,
  markCollapsedByUs,
  forgetCollapsedByUs,
  wasCollapsedByUs,
  filesCollapsedByUs,
  forgetAllHeaders,
} from "../src/file_headers.js";

const element = (id: string): HTMLElement => {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
  return el;
};

beforeEach(() => {
  document.body.innerHTML = "";
  forgetAllHeaders();
});

describe("the file header map", () => {
  it("hands back the element it was given", () => {
    const header = element("h1");

    rememberHeader("src/app.ts", header);

    expect(headerFor("src/app.ts")).toBe(header);
    expect(headerFor("src/unknown.ts")).toBeUndefined();
  });

  it("replaces an entry when GitHub re-renders a header", () => {
    rememberHeader("src/app.ts", element("old"));
    const replacement = element("new");

    rememberHeader("src/app.ts", replacement);

    expect(headerFor("src/app.ts")).toBe(replacement);
    expect(knownHeaderCount()).toBe(1);
  });

  it("counts what it knows, which is how a pass decides to skip itself", () => {
    expect(knownHeaderCount()).toBe(0);
    rememberHeader("a.ts", element("a"));
    rememberHeader("b.ts", element("b"));
    expect(knownHeaderCount()).toBe(2);
  });

  it("keeps a stale element rather than pretending it is gone", () => {
    // Rule 4: entries go stale as GitHub re-renders. Callers tolerate that; the map does not
    // try to be clever about liveness, and the next injection pass refreshes the entry.
    const header = element("detached");
    rememberHeader("src/app.ts", header);

    header.remove();

    expect(headerFor("src/app.ts")).toBe(header);
    expect(headerFor("src/app.ts")!.isConnected).toBe(false);
  });
});

describe("tracking what we collapsed", () => {
  it("remembers only what it was told", () => {
    markCollapsedByUs("src/app.ts");

    expect(wasCollapsedByUs("src/app.ts")).toBe(true);
    // A file the user collapsed themselves is not ours to expand
    expect(wasCollapsedByUs("src/other.ts")).toBe(false);
  });

  it("forgets one at a time", () => {
    markCollapsedByUs("a.ts");
    markCollapsedByUs("b.ts");

    forgetCollapsedByUs("a.ts");

    expect(filesCollapsedByUs()).toEqual(["b.ts"]);
  });

  it("returns a snapshot safe to iterate while forgetting", () => {
    // restoreFilteredFiles() forgets each file as it walks the list
    markCollapsedByUs("a.ts");
    markCollapsedByUs("b.ts");

    for (const filename of filesCollapsedByUs()) forgetCollapsedByUs(filename);

    expect(filesCollapsedByUs()).toEqual([]);
  });

  it("clears both halves on navigation", () => {
    rememberHeader("a.ts", element("a"));
    markCollapsedByUs("a.ts");

    forgetAllHeaders();

    expect(knownHeaderCount()).toBe(0);
    expect(filesCollapsedByUs()).toEqual([]);
  });
});
