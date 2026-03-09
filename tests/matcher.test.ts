import { describe, it, expect } from "vitest";
import { classifyFile, buildBreakdown } from "../src/matcher.js";
import { DEFAULT_CONFIG, type Category } from "../src/config.js";

const { categories } = DEFAULT_CONFIG;
const [main, tests, docs, generated] = categories;

describe("classifyFile", () => {
  it("classifies a spec file as Tests", () => {
    expect(classifyFile("src/utils/format.spec.ts", categories)).toBe(tests);
  });

  it("classifies a test file as Tests", () => {
    expect(classifyFile("src/utils/format.test.ts", categories)).toBe(tests);
  });

  it("classifies a __tests__ file as Tests", () => {
    expect(classifyFile("src/__tests__/format.ts", categories)).toBe(tests);
  });

  it("classifies a __mocks__ file as Tests", () => {
    expect(classifyFile("src/__mocks__/axios.ts", categories)).toBe(tests);
  });

  it("classifies a markdown file as Documentation", () => {
    expect(classifyFile("README.md", categories)).toBe(docs);
  });

  it("classifies a file in docs/ as Documentation", () => {
    expect(classifyFile("docs/architecture.md", categories)).toBe(docs);
  });

  it("classifies an SVG as Documentation", () => {
    expect(classifyFile("assets/diagram.svg", categories)).toBe(docs);
  });

  it("classifies package-lock.json as Generated / Other", () => {
    expect(classifyFile("package-lock.json", categories)).toBe(generated);
  });

  it("classifies yarn.lock as Generated / Other", () => {
    expect(classifyFile("yarn.lock", categories)).toBe(generated);
  });

  it("classifies pnpm-lock.yaml as Generated / Other", () => {
    expect(classifyFile("pnpm-lock.yaml", categories)).toBe(generated);
  });

  it("classifies a snapshot file as Generated / Other", () => {
    expect(classifyFile("src/__snapshots__/component.snap", categories)).toBe(generated);
  });

  it("classifies a dist file as Generated / Other", () => {
    expect(classifyFile("dist/bundle.js", categories)).toBe(generated);
  });

  it("classifies a regular source file as Main (fallback)", () => {
    expect(classifyFile("src/index.ts", categories)).toBe(main);
  });

  it("classifies a nested source file as Main (fallback)", () => {
    expect(classifyFile("src/components/Button.tsx", categories)).toBe(main);
  });

  it("respects order — Tests is checked before Generated", () => {
    // A spec file in dist/ should still be Tests (Tests is first)
    expect(classifyFile("dist/component.spec.ts", categories)).toBe(tests);
  });

  it("returns fallback category when nothing else matches", () => {
    const customCategories: Category[] = [
      { name: "Main", patterns: ["**/*"], fallback: true },
    ];
    expect(classifyFile("anything/at/all.xyz", customCategories)).toBe(customCategories[0]);
  });
});

describe("buildBreakdown", () => {
  it("aggregates line counts per category", () => {
    const files = [
      { filename: "src/index.ts", added: 10, removed: 5 },
      { filename: "src/util.spec.ts", added: 20, removed: 0 },
      { filename: "package-lock.json", added: 100, removed: 50 },
      { filename: "src/helper.ts", added: 3, removed: 1 },
    ];

    const result = buildBreakdown(files, categories);

    const mainStats = result.get(main)!;
    expect(mainStats.added).toBe(13);
    expect(mainStats.removed).toBe(6);
    expect(mainStats.total).toBe(19);
    expect(mainStats.files).toBe(2);

    const testStats = result.get(tests)!;
    expect(testStats.added).toBe(20);
    expect(testStats.removed).toBe(0);
    expect(testStats.total).toBe(20);
    expect(testStats.files).toBe(1);

    const genStats = result.get(generated)!;
    expect(genStats.added).toBe(100);
    expect(genStats.removed).toBe(50);
    expect(genStats.total).toBe(150);
    expect(genStats.files).toBe(1);
  });

  it("returns zero stats for categories with no matching files", () => {
    const files = [{ filename: "src/index.ts", added: 5, removed: 2 }];
    const result = buildBreakdown(files, categories);

    expect(result.get(tests)!.total).toBe(0);
    expect(result.get(tests)!.files).toBe(0);
    expect(result.get(docs)!.total).toBe(0);
    expect(result.get(generated)!.total).toBe(0);
    expect(result.get(main)!.total).toBe(7);
    expect(result.get(main)!.files).toBe(1);
  });

  it("handles an empty file list", () => {
    const result = buildBreakdown([], categories);
    for (const cat of categories) {
      expect(result.get(cat)!.total).toBe(0);
    }
  });
});
