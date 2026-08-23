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
  files: number;
};

// Compiled globs, keyed by pattern. Classifying a 3,000-file PR against ~80 patterns
// otherwise compiles a quarter of a million identical RegExps — per pass, and the content
// script runs a pass after every settled batch of DOM mutations.
const regexCache = new Map<string, RegExp>();

// Classification results, keyed by the category array's identity then by filename. Each
// pass classifies the same file list three times over (buildBreakdown, buildFilesByCategory,
// injectBadges); this collapses that to once. Keyed on identity, so a fresh config object
// from loadConfig() gets a fresh cache — but mutating a category's patterns in place would
// serve stale results, hence resetMatcherCaches() for tests.
let classifyCache = new WeakMap<Category[], Map<string, Category>>();

/** Drop memoized globs and classifications. Only needed when categories mutate in place. */
export function resetMatcherCaches(): void {
  regexCache.clear();
  classifyCache = new WeakMap();
}

function globRegex(pattern: string): RegExp {
  const cached = regexCache.get(pattern);
  if (cached) return cached;
  const compiled = new RegExp(`^${globToRegexSource(pattern)}$`);
  regexCache.set(pattern, compiled);
  return compiled;
}

function globMatch(path: string, pattern: string): boolean {
  return globRegex(pattern).test(path);
}

function globToRegexSource(pattern: string): string {
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
  return regex;
}

export function classifyFile(filename: string, categories: Category[]): Category {
  let cache = classifyCache.get(categories);
  if (!cache) {
    cache = new Map<string, Category>();
    classifyCache.set(categories, cache);
  }
  const cached = cache.get(filename);
  if (cached) return cached;

  const category = classifyUncached(filename, categories);
  cache.set(filename, category);
  return category;
}

function classifyUncached(filename: string, categories: Category[]): Category {
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
    result.set(category, { added: 0, removed: 0, total: 0, files: 0 });
  }

  for (const file of files) {
    const category = classifyFile(file.filename, categories);
    const stats = result.get(category)!;
    stats.added += file.added;
    stats.removed += file.removed;
    stats.total += file.added + file.removed;
    stats.files += 1;
  }

  return result;
}
