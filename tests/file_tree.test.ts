// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { injectTreeCounts, clearTreeCounts } from "../src/file_tree.js";

const FILES = [
  { filename: "src/app/main.ts", added: 10, removed: 2 },
  { filename: "src/app/util.ts", added: 5, removed: 0 },
  { filename: "README.md", added: 0, removed: 3 },
];

// GitHub's Primer TreeView: the full path is the <li> id, and the flex row that holds the
// icon and label is where a count can sit.
function tree(paths: string[]): void {
  document.body.innerHTML = `
    <ul role="tree" aria-label="File Tree">
      ${paths
        .map(
          (path) => `
        <li role="treeitem" id="${path}" aria-label="${path}">
          <div class="PRIVATE_TreeView-item-content prc-TreeView-TreeViewItemContent-RKsCI">
            <span>${path.split("/").pop()}</span>
          </div>
        </li>`
        )
        .join("")}
    </ul>`;
}

const countIn = (path: string) =>
  document.getElementById(path)!.querySelector(".gh-breakdown-tree-count")?.textContent ?? null;

beforeEach(() => {
  document.body.innerHTML = "";
  clearTreeCounts();
});

describe("injectTreeCounts", () => {
  it("counts files and rolls folders up", () => {
    tree(["src", "src/app", "src/app/main.ts", "src/app/util.ts", "README.md"]);

    expect(injectTreeCounts(FILES)).toBe(5);
    expect(countIn("src/app/main.ts")).toBe("+10−2");
    expect(countIn("src/app")).toBe("+15−2");
    expect(countIn("src")).toBe("+15−2");
    expect(countIn("README.md")).toBe("−3");
  });

  it("omits the half that is zero", () => {
    tree(["src/app/util.ts", "README.md"]);
    injectTreeCounts(FILES);

    expect(countIn("src/app/util.ts")).toBe("+5"); // nothing removed
    expect(countIn("README.md")).toBe("−3"); // nothing added
  });

  it("leaves rows it has no numbers for alone", () => {
    tree(["src/app/main.ts", "vendor/other.ts"]);

    expect(injectTreeCounts(FILES)).toBe(1);
    expect(countIn("vendor/other.ts")).toBeNull();
  });

  it("does no work on a second pass over an unchanged tree", () => {
    tree(["src", "src/app", "src/app/main.ts", "src/app/util.ts", "README.md"]);
    injectTreeCounts(FILES);

    // The content script re-runs after every settled batch of mutations; this is the pass
    // that used to sweep every row again to discover it had nothing to do
    expect(injectTreeCounts(FILES)).toBe(0);
    expect(document.querySelectorAll(".gh-breakdown-tree-count")).toHaveLength(5);
  });

  it("annotates rows GitHub adds later", () => {
    tree(["src", "src/app"]);
    injectTreeCounts(FILES);

    // The tree renders lazily as folders are expanded
    tree(["src", "src/app", "src/app/main.ts"]);
    expect(injectTreeCounts(FILES)).toBe(3);
    expect(countIn("src/app/main.ts")).toBe("+10−2");
  });

  it("does nothing without a tree, or without files", () => {
    expect(injectTreeCounts(FILES)).toBe(0);
    tree(["src"]);
    expect(injectTreeCounts([])).toBe(0);
  });

  it("removes every count on clear", () => {
    tree(["src", "src/app/main.ts"]);
    injectTreeCounts(FILES);

    clearTreeCounts();

    expect(document.querySelectorAll(".gh-breakdown-tree-count")).toHaveLength(0);
  });
});
