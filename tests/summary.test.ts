import { describe, it, expect } from "vitest";
import { summarize, toMarkdown, fileLabel } from "../src/summary.js";
import { buildMaps } from "../src/file_tree.js";
import { escapeHtml, escapeAttr } from "../src/html.js";
import { buildBreakdown } from "../src/matcher.js";
import type { Category } from "../src/config.js";

const CATEGORIES: Category[] = [
  { name: "Tests", color: "#0969da", patterns: ["**/*.test.ts"] },
  { name: "Docs", color: "#1a7f37", patterns: ["**/*.md"] },
  { name: "Main", color: "#6e7781", patterns: ["**/*"], fallback: true },
];

const FILES = [
  { filename: "src/app.ts", added: 60, removed: 20 },
  { filename: "src/app.test.ts", added: 30, removed: 10 },
  { filename: "src/util.test.ts", added: 10, removed: 0 },
];

const summaryOf = (files = FILES) => summarize(buildBreakdown(files, CATEGORIES), CATEGORIES);

describe("summarize", () => {
  it("adds up the totals across categories", () => {
    const summary = summaryOf();

    expect(summary).toMatchObject({
      totalAdded: 100,
      totalRemoved: 30,
      totalLines: 130,
      totalFiles: 3,
      filesLabel: "3 files",
    });
  });

  it("gives each category its share of the changed lines", () => {
    const byName = Object.fromEntries(summaryOf().rows.map((r) => [r.category.name, r]));

    expect(byName["Tests"]).toMatchObject({ percent: 38, fileLabel: "2 files", isEmpty: false });
    expect(byName["Main"]).toMatchObject({ percent: 62, fileLabel: "1 file", isEmpty: false });
    expect(byName["Docs"]).toMatchObject({ percent: 0, fileLabel: "0 files", isEmpty: true });
  });

  it("scales both bar halves against the same number", () => {
    // Added and removed are scaled to max(totalAdded, totalRemoved) = 100, so a row's two
    // halves stay comparable with every other row's
    const tests = summaryOf().rows.find((r) => r.category.name === "Tests")!;

    expect(tests.addedWidth).toBeCloseTo(40);
    expect(tests.removedWidth).toBeCloseTo(10);
  });

  it("counts the empty categories", () => {
    expect(summaryOf().emptyCount).toBe(1);
    expect(summarize(buildBreakdown([], CATEGORIES), CATEGORIES).emptyCount).toBe(3);
  });

  it("reports zeroes rather than dividing by zero on an empty diff", () => {
    const summary = summarize(buildBreakdown([], CATEGORIES), CATEGORIES);

    expect(summary.totalLines).toBe(0);
    expect(summary.rows.every((row) => row.percent === 0 && row.addedWidth === 0)).toBe(true);
  });

  it("pluralises file counts", () => {
    expect([0, 1, 2, 1500].map(fileLabel)).toEqual(["0 files", "1 file", "2 files", "1,500 files"]);
  });
});

describe("toMarkdown", () => {
  it("renders a table of the non-empty categories plus a total", () => {
    expect(toMarkdown(summaryOf())).toBe(
      [
        "| Category | Files | Added | Removed | Share |",
        "| --- | --: | --: | --: | --: |",
        "| Tests | 2 | +40 | −10 | 38% |",
        "| Main | 1 | +60 | −20 | 62% |",
        "| **Total** | **3** | **+100** | **−30** | |",
      ].join("\n")
    );
  });

  it("notes a capped file list", () => {
    expect(toMarkdown(summaryOf(), { truncated: true })).toContain("first 3,000 files");
  });
});

describe("file tree rollup", () => {
  it("accumulates each file into every ancestor folder", () => {
    const { fileMap, folderMap } = buildMaps([
      { filename: "src/app/main.ts", added: 10, removed: 2 },
      { filename: "src/app/util.ts", added: 5, removed: 1 },
      { filename: "docs/readme.md", added: 3, removed: 0 },
    ]);

    expect(fileMap.get("src/app/main.ts")).toEqual({ added: 10, removed: 2 });
    expect(folderMap.get("src/app")).toEqual({ added: 15, removed: 3 });
    expect(folderMap.get("src")).toEqual({ added: 15, removed: 3 });
    expect(folderMap.get("docs")).toEqual({ added: 3, removed: 0 });
  });

  it("does not invent a folder for a file at the repo root", () => {
    const { fileMap, folderMap } = buildMaps([{ filename: "README.md", added: 1, removed: 0 }]);

    expect(fileMap.get("README.md")).toEqual({ added: 1, removed: 0 });
    expect(folderMap.size).toBe(0);
  });

  it("keeps deep paths separate from their prefixes", () => {
    const { folderMap } = buildMaps([{ filename: "a/b/c/d.ts", added: 4, removed: 4 }]);

    expect([...folderMap.keys()]).toEqual(["a", "a/b", "a/b/c"]);
  });
});

describe("escaping", () => {
  it("escapes text between tags", () => {
    expect(escapeHtml('<b>&"x"')).toBe('&lt;b&gt;&amp;"x"');
  });

  it("escapes quotes too, for attribute values", () => {
    expect(escapeAttr('a"b\'c<d&e')).toBe("a&quot;b&#39;c&lt;d&amp;e");
  });

  it("escapes the ampersand first, so escapes are not double-escaped", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });
});

describe("sorting by size", () => {
  it("keeps category order by default, because that is matching precedence", () => {
    expect(summaryOf().rows.map((r) => r.category.name)).toEqual(["Tests", "Docs", "Main"]);
  });

  it("puts the biggest first when asked", () => {
    const sorted = summarize(buildBreakdown(FILES, CATEGORIES), CATEGORIES, { sortBySize: true });

    // Main has 80 lines, Tests 50, Docs nothing
    expect(sorted.rows.map((r) => r.category.name)).toEqual(["Main", "Tests", "Docs"]);
  });

  it("sorts stably, so equal categories do not shuffle between renders", () => {
    const categories = [
      { name: "A", patterns: ["**/*.a"] },
      { name: "B", patterns: ["**/*.b"] },
      { name: "C", patterns: ["**/*"], fallback: true as const },
    ];
    const empty = buildBreakdown([], categories);

    const once = summarize(empty, categories, { sortBySize: true }).rows.map((r) => r.category.name);
    const twice = summarize(empty, categories, { sortBySize: true }).rows.map((r) => r.category.name);

    expect(once).toEqual(["A", "B", "C"]);
    expect(twice).toEqual(once);
  });

  it("counts the same either way", () => {
    const ordered = summaryOf();
    const sorted = summarize(buildBreakdown(FILES, CATEGORIES), CATEGORIES, { sortBySize: true });

    expect(sorted.totalLines).toBe(ordered.totalLines);
    expect(sorted.emptyCount).toBe(ordered.emptyCount);
  });
});
