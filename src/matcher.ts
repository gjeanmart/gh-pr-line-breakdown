import type { Category } from "./config.js";

export type FileEntry = {
  filename: string;
  added: number;
  removed: number;
};

export type CategoryStats = {
  added: number;
  removed: number;
  total: number;
};

function globMatch(path: string, pattern: string): boolean {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      if (i === 0 && pattern[i + 2] === "/") {
        // **/ at start → optional path prefix
        regex += "(.*/)?";
        i += 3;
      } else if (i > 0 && pattern[i - 1] === "/" && pattern[i + 2] === "/") {
        // /**/ in middle → remove already-emitted / then add optional segment
        regex = regex.slice(0, -1) + "(/.*)?/";
        i += 3;
      } else {
        // /** at end or bare **
        regex += ".*";
        i += 2;
      }
    } else if (ch === "*") {
      regex += "[^/]*";
      i++;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      regex += "\\" + ch;
      i++;
    } else {
      regex += ch;
      i++;
    }
  }
  return new RegExp(`^${regex}$`).test(path);
}

export function classifyFile(filename: string, categories: Category[]): Category {
  for (const category of categories) {
    if (category.fallback) continue;
    for (const pattern of category.patterns) {
      if (globMatch(filename, pattern)) {
        return category;
      }
    }
  }
  const fallback = categories.find((c) => c.fallback);
  return fallback ?? categories[categories.length - 1];
}

export function buildBreakdown(
  files: FileEntry[],
  categories: Category[]
): Map<Category, CategoryStats> {
  const result = new Map<Category, CategoryStats>();
  for (const category of categories) {
    result.set(category, { added: 0, removed: 0, total: 0 });
  }

  for (const file of files) {
    const category = classifyFile(file.filename, categories);
    const stats = result.get(category)!;
    stats.added += file.added;
    stats.removed += file.removed;
    stats.total += file.added + file.removed;
  }

  return result;
}
