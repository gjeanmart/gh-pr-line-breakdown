import { describe, it, expect } from "vitest";
import { normalizeCategories, parseImportedCategories, DEFAULT_CONFIG } from "../src/config.js";
import { classifyFile } from "../src/matcher.js";
import type { Category } from "../src/config.js";

const cat = (name: string, patterns: string[], fallback?: true): Category =>
  fallback ? { name, patterns, fallback } : { name, patterns };

describe("normalizeCategories", () => {
  it("leaves a well-formed list alone", () => {
    expect(normalizeCategories(DEFAULT_CONFIG.categories)).toEqual(DEFAULT_CONFIG.categories);
  });

  it("adopts the catch-all category when no fallback is declared", () => {
    const result = normalizeCategories([
      cat("Everything", ["**/*"]),
      cat("Tests", ["**/*.test.ts"]),
    ]);

    expect(result.map((c) => c.fallback)).toEqual([true, undefined]);
  });

  it("falls back to the last category when nothing looks like a catch-all", () => {
    const result = normalizeCategories([cat("Tests", ["**/*.test.ts"]), cat("Rest", ["**/*.ts"])]);

    expect(result.map((c) => c.fallback)).toEqual([undefined, true]);
  });

  it("keeps the first when several claim to be the fallback", () => {
    const result = normalizeCategories([
      cat("Tests", ["**/*.test.ts"]),
      cat("A", ["**/*"], true),
      cat("B", ["**/*"], true),
    ]);

    expect(result.map((c) => c.fallback)).toEqual([undefined, true, undefined]);
  });

  it("means an unmatched file always lands in a real fallback", () => {
    // Without this guarantee classifyFile quietly used whichever category came last
    const categories = normalizeCategories([
      cat("Catch all", ["**/*"]),
      cat("Tests", ["**/*.test.ts"]),
      cat("Styles", ["**/*.css"]),
    ]);

    expect(classifyFile("src/server/main.go", categories).name).toBe("Catch all");
  });

  it("copes with an empty list", () => {
    expect(normalizeCategories([])).toEqual([]);
  });
});

describe("parseImportedCategories", () => {
  const exported = JSON.stringify({ categories: [cat("Docs", ["**/*.md"]), cat("Rest", ["**/*"])] });

  it("accepts a file this extension exported", () => {
    const result = parseImportedCategories(exported);

    expect(result).toEqual([
      { name: "Docs", patterns: ["**/*.md"] },
      { name: "Rest", patterns: ["**/*"], fallback: true },
    ]);
  });

  it("guarantees a fallback even when the file has none", () => {
    const result = parseImportedCategories(
      JSON.stringify({ categories: [cat("Docs", ["**/*.md"]), cat("Code", ["**/*.ts"])] })
    );

    expect(result!.filter((c) => c.fallback)).toHaveLength(1);
  });

  it("trims names and patterns, and drops blank patterns", () => {
    const result = parseImportedCategories(
      JSON.stringify({ categories: [{ name: "  Docs  ", patterns: [" **/*.md ", "", "   "] }] })
    );

    expect(result).toEqual([{ name: "Docs", patterns: ["**/*.md"], fallback: true }]);
  });

  it("keeps a colour when there is one, and no colour when there is not", () => {
    const result = parseImportedCategories(
      JSON.stringify({ categories: [{ name: "Docs", patterns: ["*.md"], color: "#1a7f37" }] })
    );

    expect(result![0].color).toBe("#1a7f37");
    expect(parseImportedCategories(exported)![0]).not.toHaveProperty("color");
  });

  it.each([
    ["not JSON at all", "{nope"],
    ["an empty document", ""],
    ["a bare array", "[]"],
    ["no categories key", '{"token":"ghp_x"}'],
    ["an empty category list", '{"categories":[]}'],
    ["a category with no name", '{"categories":[{"patterns":["*.md"]}]}'],
    ["a blank name", '{"categories":[{"name":"  ","patterns":["*.md"]}]}'],
    ["patterns that are not an array", '{"categories":[{"name":"Docs","patterns":"*.md"}]}'],
    ["a non-string pattern", '{"categories":[{"name":"Docs","patterns":[42]}]}'],
    ["a null entry", '{"categories":[null]}'],
  ])("rejects %s", (_label, json) => {
    expect(parseImportedCategories(json)).toBeNull();
  });
});
